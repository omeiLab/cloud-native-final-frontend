"""notification 模組的 APScheduler 排程任務(設計 06 §11.7 +)

三個任務,跨副本以 advisory_xact_lock 互斥:

| 任務 | 觸發 | 動作 |
|------|------|------|
| notification_retry_scan | 5 分鐘 | 掃 PENDING + 退避 5/10/15 → 重送 / 上限改 FAILED |
| event_reminder_scan | 60 分鐘 | 掃 24h 後開始的 session,發 EVENT_REMINDER |
| confirmation_reminder_scan | 30 分鐘 | 掃 deadline 24h / 1h 內的 WON,發 CONFIRMATION_REMINDER |

提醒類任務需有「不重複發送」保證 — 用 notifications.type+payload 去重(設計暫不引入
新 reminders 表,以 INSERT 前 SELECT 同 user/type/payload.session_id 是否已存在判斷)。
 lab 階段先用最簡實作:每場活動只發一次提醒,以 created_at > NOW()-25h 過濾防雙發。
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
    JOB_ID_NOTIFICATION_CONFIRM_REMINDER,
    JOB_ID_NOTIFICATION_EVENT_REMINDER,
    JOB_ID_NOTIFICATION_RETRY,
    JOB_ID_NOTIFICATIONS_CLEANUP,
    try_advisory_xact_lock,
)
from app.modules.auth.dependencies import build_auth_service
from app.modules.notification.repository import NotificationRepository
from app.modules.notification.service import NotificationService

logger = get_logger(__name__).bind(component="notification")

_JOB_RETRY = "notification_retry_scan"
_JOB_CLEANUP = "notifications_cleanup_scan"
_JOB_EVENT_REMINDER = "event_reminder_scan"
_JOB_CONFIRM_REMINDER = "confirmation_reminder_scan"


async def notification_retry_job() -> None:
    """每 5 分鐘掃 PENDING + 退避視窗到的紀錄重送(設計 06 §11.7)。

    跨副本以 advisory_xact_lock 互斥。失敗紀錄達 retry_count 上限改 FAILED。
    """
    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_NOTIFICATION_RETRY)
            if not locked:
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_RETRY, outcome="skipped").inc()
                return

            start = time.monotonic()
            notification_svc = NotificationService(session, build_auth_service(session))
            processed = await notification_svc.retry_pending()
            SCHEDULER_JOB_DURATION.labels(job=_JOB_RETRY).observe(time.monotonic() - start)
            SCHEDULER_JOB_RUNS.labels(job=_JOB_RETRY, outcome="success").inc()
            if processed > 0:
                logger.info("notification_retry_done", processed=processed)
        except SQLAlchemyError:
            logger.exception("notification_retry_db_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_RETRY, outcome="error").inc()
        except Exception:
            logger.exception("notification_retry_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_RETRY, outcome="error").inc()
            raise


async def notifications_cleanup_job() -> None:
    """每日 03:00 — 清 90 天前 notifications(設計 04 §8.3)。
    跨副本以 advisory_xact_lock 互斥(JOB_ID_NOTIFICATIONS_CLEANUP)。
    """
    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_NOTIFICATIONS_CLEANUP)
            if not locked:
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_CLEANUP, outcome="skipped").inc()
                return

            start = time.monotonic()
            repo = NotificationRepository(session)
            deleted = await repo.delete_old(older_than_days=90)
            await session.commit()
            SCHEDULER_JOB_DURATION.labels(job=_JOB_CLEANUP).observe(time.monotonic() - start)
            SCHEDULER_JOB_RUNS.labels(job=_JOB_CLEANUP, outcome="success").inc()
            if deleted > 0:
                logger.info("notifications_cleanup_done", deleted=deleted)
        except SQLAlchemyError:
            logger.exception("notifications_cleanup_db_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_CLEANUP, outcome="error").inc()
        except Exception:
            logger.exception("notifications_cleanup_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_CLEANUP, outcome="error").inc()
            raise


async def event_reminder_job() -> None:
    """.1:每小時掃 starts_at 在 (NOW+23h, NOW+25h] 區間的 session,
    對 CONFIRMED 報名者送 EVENT_REMINDER。

    去重:同 user + EVENT_REMINDER + payload.session_id 在 25h 內已存在則 skip
    (避免 cron 觸發兩次重複發送)。
    """
    from datetime import timedelta

    from app.core.time import now_utc
    from app.modules.event.service import EventService
    from app.modules.notification.repository import NotificationRepository
    from app.modules.registration.service import RegistrationService

    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_NOTIFICATION_EVENT_REMINDER)
            if not locked:
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_EVENT_REMINDER, outcome="skipped").inc()
                return

            event_svc = EventService(session)
            reg_svc = RegistrationService(session, event_svc)
            notif_repo = NotificationRepository(session)
            notif_svc = NotificationService(session, build_auth_service(session))

            now = now_utc()
            sessions = await event_svc.list_sessions_starting_in_window(
                after=now + timedelta(hours=23),
                before=now + timedelta(hours=25),
            )
            sent_count = 0
            for sess in sessions:
                event = await event_svc.get_event(sess.event_id)
                event_title = event.title if event else ""
                regs = await reg_svc.list_by_session(sess.id, status="CONFIRMED")
                for reg in regs:
                    # 去重:25h 內同 user + 同 session_id 已發過則 skip
                    if await notif_repo.has_recent_for_user(
                        reg.user_id,
                        type="EVENT_REMINDER",
                        within_hours=25,
                        payload_session_id=sess.id,
                    ):
                        continue
                    try:
                        await notif_svc.send(
                            user_id=reg.user_id,
                            type="EVENT_REMINDER",
                            payload={
                                "event_title": event_title,
                                "session_id": sess.id,
                                "session_starts_at": sess.starts_at.isoformat(),
                            },
                        )
                        sent_count += 1
                    except Exception:
                        logger.exception(
                            "event_reminder_send_failed",
                            user_id=reg.user_id,
                            session_id=sess.id,
                        )

            await session.commit()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_EVENT_REMINDER, outcome="success").inc()
            if sent_count > 0:
                logger.info("event_reminder_sent", count=sent_count)
        except Exception:
            logger.exception("event_reminder_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_EVENT_REMINDER, outcome="error").inc()
            raise


async def confirmation_reminder_job() -> None:
    """.1:每 30 分鐘掃 WON 報名者 deadline 接近 24h / 1h 提醒。

    兩個窗:
    - 24h 窗:(NOW+23h, NOW+25h] — 去重 25h
    - 1h 窗:(NOW+30min, NOW+90min] — 去重 1.5h(不會跟 24h 衝突,有獨立 dedup)
    """
    from datetime import timedelta

    from app.core.time import now_utc
    from app.modules.event.service import EventService
    from app.modules.notification.repository import NotificationRepository
    from app.modules.registration.service import RegistrationService

    session_maker = get_rw_session_maker()
    async with session_maker() as session:
        try:
            locked = await try_advisory_xact_lock(session, JOB_ID_NOTIFICATION_CONFIRM_REMINDER)
            if not locked:
                await session.rollback()
                SCHEDULER_JOB_RUNS.labels(job=_JOB_CONFIRM_REMINDER, outcome="skipped").inc()
                return

            event_svc = EventService(session)
            reg_svc = RegistrationService(session, event_svc)
            notif_repo = NotificationRepository(session)
            notif_svc = NotificationService(session, build_auth_service(session))

            now = now_utc()
            sent_count = 0
            for window_after, window_before, dedup_hours, hours_remaining_label in [
                (now + timedelta(hours=23), now + timedelta(hours=25), 25, "24"),
                (now + timedelta(minutes=30), now + timedelta(minutes=90), 2, "1"),
            ]:
                regs = await reg_svc.list_won_with_deadline_in_window(window_after, window_before)
                for reg in regs:
                    if await notif_repo.has_recent_for_user(
                        reg.user_id,
                        type="CONFIRMATION_REMINDER",
                        within_hours=dedup_hours,
                        payload_session_id=reg.session_id,
                    ):
                        continue
                    sess = await event_svc.get_session(reg.session_id)
                    event_title = ""
                    if sess:
                        ev = await event_svc.get_event(sess.event_id)
                        if ev:
                            event_title = ev.title
                    try:
                        await notif_svc.send(
                            user_id=reg.user_id,
                            type="CONFIRMATION_REMINDER",
                            payload={
                                "event_title": event_title,
                                "session_id": reg.session_id,
                                "confirmation_deadline": reg.confirmation_deadline.isoformat()
                                if reg.confirmation_deadline
                                else "",
                                "hours_remaining": hours_remaining_label,
                            },
                        )
                        sent_count += 1
                    except Exception:
                        logger.exception(
                            "confirmation_reminder_send_failed",
                            user_id=reg.user_id,
                            registration_id=reg.id,
                        )

            await session.commit()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_CONFIRM_REMINDER, outcome="success").inc()
            if sent_count > 0:
                logger.info("confirmation_reminder_sent", count=sent_count)
        except Exception:
            logger.exception("confirmation_reminder_unexpected_error")
            await session.rollback()
            SCHEDULER_JOB_RUNS.labels(job=_JOB_CONFIRM_REMINDER, outcome="error").inc()
            raise


def register_notification_jobs(scheduler: AsyncIOScheduler) -> None:
    """於 lifespan startup 階段註冊 notification 模組的排程任務。

    event_reminder_scan / confirmation_reminder_scan(設計 06 §11.4 EVENT_REMINDER /
    CONFIRMATION_REMINDER)— 暫由 caller 模組(event/registration)在事件
    觸發時主動 send;APScheduler scan 留 admin 完成後加,屆時補對應 service
    方法 + advisory lock。
    """
    scheduler.add_job(
        notification_retry_job,
        "interval",
        minutes=5,
        id=_JOB_RETRY,
        max_instances=1,
        coalesce=True,
    )
    # — 每日 03:00 清 90 天前 notifications(設計 04 §8.3)
    scheduler.add_job(
        notifications_cleanup_job,
        "cron",
        hour=3,
        minute=0,
        id=_JOB_CLEANUP,
        max_instances=1,
        coalesce=True,
    )
    # reminder scans — stub 階段(.5+ 接 caller 後完整化)
    scheduler.add_job(
        event_reminder_job,
        "interval",
        hours=1,
        id=_JOB_EVENT_REMINDER,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        confirmation_reminder_job,
        "interval",
        minutes=30,
        id=_JOB_CONFIRM_REMINDER,
        max_instances=1,
        coalesce=True,
    )
    logger.info(
        "notification_jobs_registered",
        jobs=[_JOB_RETRY, _JOB_CLEANUP, _JOB_EVENT_REMINDER, _JOB_CONFIRM_REMINDER],
    )
