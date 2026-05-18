"""APScheduler wrapper — 跨副本互斥靠 pg_try_advisory_xact_lock(設計 07 §8)

Lock ID 命名空間規劃(每個排程任務一個獨立 ID,避免衝突):

| Lock ID | 任務 | Phase |
|---------|------|-------|
| 1001 | registration.expire_overdue_won | 3 |
| 2001 | lottery-runner | 4 |
| 3001 | notification.retry_pending | 6 |
| 3002 | notification.event_reminder_scan | 6/7(stub→ 完整化)|
| 3003 | notification.confirmation_reminder_scan | 6/7(stub→ 完整化)|
| 4001 | notification.notifications_cleanup_scan | 7 |
| 4002 | admin.archive_old_events_scan | 7(stub→ 完整化)|
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)

JOB_ID_EXPIRE_OVERDUE_WON = 1001
JOB_ID_LOTTERY_RUNNER = 2001 # lottery-runner CronJob 預留
JOB_ID_NOTIFICATION_RETRY = 3001 # 通知重試
JOB_ID_NOTIFICATION_EVENT_REMINDER = 3002 # 活動前 24h 提醒
JOB_ID_NOTIFICATION_CONFIRM_REMINDER = 3003 # 確認前 24h / 1h 提醒
JOB_ID_NOTIFICATIONS_CLEANUP = 4001 # notifications 90 天保留
JOB_ID_ARCHIVE_OLD_EVENTS = 4002 # archive 兩年前活動到 MinIO
JOB_ID_EXPORT_DRAIN = 4003 # admin export 背景化(每 30s drain queue)

_scheduler: AsyncIOScheduler | None = None


def init_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = AsyncIOScheduler(timezone="Asia/Taipei")
    _scheduler.start()
    logger.info("scheduler_started")
    return _scheduler


def get_scheduler() -> AsyncIOScheduler:
    if _scheduler is None:
        raise RuntimeError("Scheduler not initialized")
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("scheduler_stopped")


async def try_advisory_xact_lock(session: AsyncSession, lock_id: int) -> bool:
    """嘗試取 transaction-bound advisory lock。

    取到 → True;取不到(其他副本持有) → False。
    Lock 綁在 transaction,commit/rollback 時自動釋放,無需 unlock。
    適用:單一 transaction 內的短任務(例:registration.expire_overdue_won)。
    """
    result = await session.execute(
        text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
        {"lock_id": lock_id},
    )
    return bool(result.scalar())


async def try_advisory_session_lock(session: AsyncSession, lock_id: int) -> bool:
    """嘗試取 session-bound advisory lock(實際上是 connection-bound)。

    Lock 綁在連線而非 transaction,跨多個 commit 仍持有 — 適合需要橫跨多個
    transaction 的批次任務(例:lottery_runner 處理多 session,每場一個
    commit 但整 batch 需互斥)。

    **使用須知**:同一個 connection 必須拿來執行後續操作,不能換 session。
    建議於專屬 lock_session 持鎖,業務用獨立 work_session 跑(讓
    work_session 內 commit/rollback 不影響 lock)。

    解鎖**必須**呼叫:func:`advisory_session_unlock`(否則 lock 會一直持有
    到 connection 關閉)。
    """
    result = await session.execute(
        text("SELECT pg_try_advisory_lock(:lock_id)"),
        {"lock_id": lock_id},
    )
    return bool(result.scalar())


async def advisory_session_unlock(session: AsyncSession, lock_id: int) -> None:
    """釋放 try_advisory_session_lock 取得的鎖"""
    await session.execute(
        text("SELECT pg_advisory_unlock(:lock_id)"),
        {"lock_id": lock_id},
    )
