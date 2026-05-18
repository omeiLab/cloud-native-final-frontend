"""registration 模組的 APScheduler 排程任務(設計 06 §8.7、07 §8)

main.py 的 lifespan 啟動 scheduler 後呼叫 register_registration_jobs() 註冊。
跨副本互斥靠 pg_try_advisory_xact_lock,取不到鎖立即返回。
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
from app.core.scheduler import JOB_ID_EXPIRE_OVERDUE_WON, try_advisory_xact_lock
from app.modules.event.service import EventService
from app.modules.registration.service import RegistrationService

logger = get_logger(__name__)

_JOB_NAME = "expire_overdue_won"


async def expire_overdue_won_job() -> None:
    """每分鐘觸發 — 跨副本以 advisory_xact_lock 互斥(設計 07 §8)。

    取到鎖才掃 WON+逾期,改 EXPIRED + 觸發候補遞補;取不到鎖立即 return。
    metrics:`cets_scheduler_job_runs_total{job, outcome}` 記
    success / skipped / error 三種終態。
    """
    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_EXPIRE_OVERDUE_WON)
            if not locked:
                # log 改 INFO 級:每分鐘一條,Loki 量可忽略,但能在 mutex 失效時看出來
                logger.info("expire_overdue_won_skip_other_pod_holds_lock")
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="skipped").inc()
                return

            start = time.monotonic()
            event_svc = EventService(session)
            reg_svc = RegistrationService(session, event_svc)
            count = await reg_svc.expire_overdue_won()
            # service 內部已 commit + REGISTRATION_EXPIRED_TOTAL.inc per row;lock 連帶釋放
            SCHEDULER_JOB_DURATION.labels(job=_JOB_NAME).observe(time.monotonic() - start)
            SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="success").inc()
            if count > 0:
                logger.info("expire_overdue_won_job_done", processed=count)
        except SQLAlchemyError:
            # DB 暫時無法用 — log + rollback,不再傳播,避免 APScheduler 把 job 卸下
            logger.exception("expire_overdue_won_job_db_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="error").inc()
        except Exception:
            # 程式 bug — 走 APScheduler EVENT_JOB_ERROR 才看得見,所以 re-raise
            logger.exception("expire_overdue_won_job_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="error").inc()
            raise


def register_registration_jobs(scheduler: AsyncIOScheduler) -> None:
    """於 lifespan startup 階段註冊 registration 模組的排程任務"""
    scheduler.add_job(
        expire_overdue_won_job,
        "interval",
        minutes=1,
        id=_JOB_NAME,
        max_instances=1,
        coalesce=True, # 上次還沒跑完就跳過,不堆積
    )
    logger.info(
        "registration_jobs_registered",
        job=_JOB_NAME,
        interval_seconds=60,
    )
