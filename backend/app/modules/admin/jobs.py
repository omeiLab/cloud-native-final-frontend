"""admin 模組 APScheduler 排程任務(設計 04 §8.2 archive)

| 任務 | 觸發 | 動作 |
|------|------|------|
| archive_old_events_job | 每月 1 日 04:00 | 掃 ended > 2 年活動 → MinIO/S3 |
| export_drain_job | 每 30 秒 | 拉一個 export task 跑 export → 上傳 → 更新 state |

 Batch B(A3):從 stub 升級為真實上傳:
- 透過 `EventServiceProtocol` 拉候選 + EventDetail
- 透過 `core.object_storage` 上傳 JSONL 到 archive bucket
- registrations / tickets 跨模組 archive 留 (需要對應模組各自加
  snapshot 介面)
- DELETE 留 (各模組 owner 模組做,admin 不直接刪他人 table)

`notifications_cleanup_job` 屬 notification 模組,於 notification.jobs 註冊
(設計 04 §8.3,owner = notification 模組; 跨模組不直接讀寫他模組 repo)。

跨副本互斥靠 advisory_xact_lock,取不到鎖立即返回。

 IAM 設計預埋(實作於 cets-platform):
- boto3 credentials 走 K8s Secret cets-minio-archive-key(獨立於 main-api
  Auth0 / JWT secrets,scope 限定 archive bucket only)
- bucket policy:`s3:PutObject` only,不給 `ListBucket` / `GetObject` 給 main-api
- rotation 走 key-rotation.md(同 grafana-cloud-auth 模式,>80d 觸發告警)
- production 強烈建議走 IRSA(EKS)/ Workload Identity(GKE)取代 static
  credentials;K8s pod 被 RCE 時 archive bucket 寫入也僅限該 namespace 的 pod
"""

import time

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.exc import SQLAlchemyError

from app.core.db import get_rw_session_maker
from app.core.logging import get_logger
from app.core.metrics import (
    SCHEDULER_JOB_DURATION,
    SCHEDULER_JOB_RUNS,
)
from app.core.scheduler import (
    JOB_ID_ARCHIVE_OLD_EVENTS,
    try_advisory_xact_lock,
)
from app.modules.admin.archiver import archive_old_events
from app.modules.admin.export_worker import export_drain_job
from app.modules.event.service import EventService

logger = get_logger(__name__).bind(component="admin")

_JOB_ARCHIVE = "archive_old_events_scan"
_JOB_EXPORT_DRAIN = "export_drain_scan"


async def archive_old_events_job() -> None:
    """每月 1 日 04:00 — 掃 ended > 2 年的活動,序列化後上傳至 archive bucket。"""
    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_ARCHIVE_OLD_EVENTS)
            if not locked:
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_ARCHIVE, outcome="skipped").inc()
                return

            start = time.monotonic()
            event_svc = EventService(session)
            result = await archive_old_events(event_svc)
            await session.commit()
            SCHEDULER_JOB_DURATION.labels(job=_JOB_ARCHIVE).observe(time.monotonic() - start)
            SCHEDULER_JOB_RUNS.labels(job=_JOB_ARCHIVE, outcome="success").inc()
            logger.info(
                "archive_old_events_job_done",
                candidates=len(result.candidates),
                uploaded=result.uploaded,
                dry_run=result.dry_run,
            )
        except SQLAlchemyError:
            logger.exception("archive_old_events_db_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_ARCHIVE, outcome="error").inc()
        except Exception:
            logger.exception("archive_old_events_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_ARCHIVE, outcome="error").inc()
            raise


def register_admin_jobs(scheduler: AsyncIOScheduler) -> None:
    """於 lifespan startup 階段註冊 admin 模組的排程任務"""
    scheduler.add_job(
        archive_old_events_job,
        "cron",
        day=1,
        hour=4,
        minute=0,
        id=_JOB_ARCHIVE,
        max_instances=1,
        coalesce=True,
    )
    # Batch B(A6):export 背景化 — 每 30s 掃 queue 跑一個 task
    scheduler.add_job(
        export_drain_job,
        "interval",
        seconds=30,
        id=_JOB_EXPORT_DRAIN,
        max_instances=1,
        coalesce=True,
    )
    logger.info("admin_jobs_registered", jobs=[_JOB_ARCHIVE, _JOB_EXPORT_DRAIN])
