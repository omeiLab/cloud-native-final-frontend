"""admin export worker — 背景跑 export task(Batch B A6)。

每 30s 從 Redis queue 拉一個 task,跑 export 邏輯後上傳 archive bucket
(同 archive 共用 cets-minio-archive-key Secret + bucket policy)。

跨副本互斥靠 PG advisory_xact_lock,取不到鎖把 task 推回 queue 頭部。

範圍邊界(留):
- 仍走 in-memory 序列化(`export_csv` / `export_xlsx`),50000 筆 ~ 30MB
  接受;>50000 走 ASYNC_HARD_LIMIT 拒。chunked CSV stream 留 。
- download endpoint 走 main-api 代理(StreamingResponse),不用 presigned URL;
  presigned URL 留 。
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from sqlalchemy.exc import SQLAlchemyError

from app.core.db import get_rw_session_maker
from app.core.logging import get_logger
from app.core.metrics import (
    SCHEDULER_JOB_DURATION,
    SCHEDULER_JOB_RUNS,
)
from app.core.object_storage import is_archive_storage_configured, put_archive_object
from app.core.redis import get_redis
from app.core.scheduler import (
    JOB_ID_EXPORT_DRAIN,
    try_advisory_xact_lock,
)
from app.modules.admin.export_state import (
    QUEUE_KEY,
    get_state,
    mark_failed,
    mark_running,
    mark_succeeded,
    pop_pending,
)
from app.modules.admin.exporter import (
    export_csv,
    export_xlsx,
    sanitize_for_export,
)
from app.modules.admin.service import AdminService
from app.modules.auth.dependencies import build_auth_service
from app.modules.event.service import EventService
from app.modules.lottery.service import LotteryService
from app.modules.registration.service import RegistrationService
from app.modules.ticket.service import TicketService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = get_logger(__name__).bind(component="export_worker")

# 背景化路徑也設上限,防 in-memory 序列化爆 RAM
ASYNC_HARD_LIMIT = 50000

_JOB_EXPORT = "export_drain_scan"


async def export_drain_job() -> None:
    """每 30s 跑一次 — 取一個 task 跑完;沒 task 就 idle 返回。"""
    redis = get_redis()
    task_id = await pop_pending(redis)
    if task_id is None:
        SCHEDULER_JOB_RUNS.labels(job=_JOB_EXPORT, outcome="idle").inc()
        return

    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_EXPORT_DRAIN)
            if not locked:
                # 別的副本正在跑;把 task 推回 queue 頭部讓它下一輪重試
                await redis.lpush(QUEUE_KEY, task_id) # type: ignore[misc]
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_EXPORT, outcome="skipped").inc()
                return

            start = time.monotonic()
            await mark_running(redis, task_id)
            state = await get_state(redis, task_id)
            if state is None:
                logger.warning("export_task_expired_in_queue", task_id=task_id)
                await session.commit()
                return

            try:
                object_key = await _run_export(session, state)
                await mark_succeeded(redis, task_id, object_key=object_key)
                SCHEDULER_JOB_RUNS.labels(job=_JOB_EXPORT, outcome="success").inc()
                logger.info("export_task_succeeded", task_id=task_id, object_key=object_key)
            except Exception as e:
                await mark_failed(redis, task_id, error=str(e))
                SCHEDULER_JOB_RUNS.labels(job=_JOB_EXPORT, outcome="error").inc()
                logger.exception("export_task_failed", task_id=task_id)

            await session.commit()
            SCHEDULER_JOB_DURATION.labels(job=_JOB_EXPORT).observe(time.monotonic() - start)
        except SQLAlchemyError:
            logger.exception("export_drain_db_error", task_id=task_id)
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_EXPORT, outcome="error").inc()


async def _run_export(session: AsyncSession, state: dict[str, str]) -> str:
    """跑 export 邏輯,回 archive bucket 的 object key。"""
    if not is_archive_storage_configured():
        raise RuntimeError("archive object storage 未設定 — 無法上傳 export(設 archive_s3_*)")

    event_id = state["event_id"]
    fmt = state["format"]
    mask_pii = state["mask_pii"] == "1"
    task_id = state["task_id"]

    event_svc = EventService(session)
    reg_svc = RegistrationService(session, event_svc)
    ticket_svc = TicketService(session, event_svc, reg_svc) # qr_signer=None
    auth_svc = build_auth_service(session)
    lottery_svc = LotteryService(session, event_svc, reg_svc)
    admin_svc = AdminService(
        event_svc=event_svc,
        registration_svc=reg_svc,
        ticket_svc=ticket_svc,
        auth_svc=auth_svc,
        lottery_svc=lottery_svc,
    )

    paged = await admin_svc.list_event_registrations(
        event_id, page=1, page_size=ASYNC_HARD_LIMIT, mask_pii=mask_pii
    )
    if paged.total > ASYNC_HARD_LIMIT:
        raise RuntimeError(
            f"event {event_id} 報名筆數 {paged.total} > 背景化上限 {ASYNC_HARD_LIMIT}"
        )

    items = sanitize_for_export(paged.items)

    if fmt == "csv":
        body = export_csv(items)
        ext = "csv"
        content_type = "text/csv; charset=utf-8"
    elif fmt == "xlsx":
        body = export_xlsx(items)
        ext = "xlsx"
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        raise ValueError(f"unsupported format: {fmt}")

    key = f"exports/{event_id}/{task_id}.{ext}"
    await put_archive_object(key=key, body=body, content_type=content_type)
    return key


__all__ = ["ASYNC_HARD_LIMIT", "export_drain_job"]
