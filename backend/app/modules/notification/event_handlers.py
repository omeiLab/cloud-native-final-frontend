"""notification 模組訂閱跨模組事件,送對應通知()。

設計 06 §5.5 in-process event bus 模式 — 上層(registration / lottery / ticket)
publish 事件,本模組 subscribe 後 send_batch。每個 handler 用自己的 session_maker
取 RW session,避免污染 publisher 的 transaction。

由 main.lifespan 啟動時呼叫 register_notification_handlers(event_bus)。
"""

from app.core.db import get_rw_session_maker
from app.core.events import (
    ConfirmationExpired,
    DomainEvent,
    EventBus,
    EventCancelled,
    LotteryCompleted,
    RegistrationCreated,
    WaitlistPromoted,
)
from app.core.logging import get_logger
from app.modules.auth.dependencies import build_auth_service
from app.modules.notification.service import NotificationService

logger = get_logger(__name__).bind(component="notification")


async def _build_svc() -> tuple[NotificationService, object]:
    """建一個 NotificationService 實例 + 對應 session(handler 自管 commit)"""
    session_maker = get_rw_session_maker()
    session = session_maker()
    svc = NotificationService(session, build_auth_service(session))
    return svc, session


async def _on_registration_created(event: DomainEvent) -> None:
    if not isinstance(event, RegistrationCreated):
        return
    svc, session = await _build_svc()
    try:
        await svc.send(
            user_id=event.user_id,
            type="REGISTRATION_CONFIRMED",
            payload={
                "event_title": event.event_title,
                "session_starts_at": event.session_starts_at,
                "lottery_at": "", # 不阻擋,template 用空字串
            },
        )
    finally:
        await session.close() # type: ignore[attr-defined]


async def _on_lottery_completed(event: DomainEvent) -> None:
    if not isinstance(event, LotteryCompleted):
        return
    svc, session = await _build_svc()
    try:
        # winners
        if event.winner_user_ids:
            await svc.send_batch(
                user_ids=event.winner_user_ids,
                type="LOTTERY_WON",
                payload_per_user={
                    uid: {
                        "event_title": event.event_title,
                        "confirmation_deadline": event.confirmation_deadline,
                    }
                    for uid in event.winner_user_ids
                },
            )
        if event.waitlist_user_ids:
            await svc.send_batch(
                user_ids=event.waitlist_user_ids,
                type="WAITLISTED",
                payload_per_user={
                    uid: {
                        "event_title": event.event_title,
                        "waitlist_position": "—", # rank 在 LotteryCompleted 中沒帶 — 簡化
                    }
                    for uid in event.waitlist_user_ids
                },
            )
        if event.loser_user_ids:
            await svc.send_batch(
                user_ids=event.loser_user_ids,
                type="LOTTERY_LOST",
                payload_per_user={
                    uid: {"event_title": event.event_title} for uid in event.loser_user_ids
                },
            )
        logger.info(
            "lottery_completed_notifications_sent",
            session_id=event.session_id,
            ticket_type_id=event.ticket_type_id,
            winners=len(event.winner_user_ids),
            waitlist=len(event.waitlist_user_ids),
            losers=len(event.loser_user_ids),
        )
    finally:
        await session.close() # type: ignore[attr-defined]


async def _on_waitlist_promoted(event: DomainEvent) -> None:
    if not isinstance(event, WaitlistPromoted):
        return
    svc, session = await _build_svc()
    try:
        await svc.send(
            user_id=event.user_id,
            type="WAITLIST_PROMOTED",
            payload={
                "event_title": event.event_title,
                "confirmation_deadline": event.confirmation_deadline,
            },
        )
    finally:
        await session.close() # type: ignore[attr-defined]


async def _on_confirmation_expired(event: DomainEvent) -> None:
    if not isinstance(event, ConfirmationExpired):
        return
    svc, session = await _build_svc()
    try:
        await svc.send(
            user_id=event.user_id,
            type="CONFIRMATION_EXPIRED",
            payload={"event_title": event.event_title, "deadline": event.deadline},
        )
    finally:
        await session.close() # type: ignore[attr-defined]


async def _on_event_cancelled(event: DomainEvent) -> None:
    if not isinstance(event, EventCancelled):
        return
    if not event.affected_user_ids:
        return
    svc, session = await _build_svc()
    try:
        await svc.send_batch(
            user_ids=event.affected_user_ids,
            type="EVENT_CANCELLED",
            payload_per_user={
                uid: {"event_title": event.event_title, "reason": event.reason}
                for uid in event.affected_user_ids
            },
        )
    finally:
        await session.close() # type: ignore[attr-defined]


def register_notification_handlers(bus: EventBus) -> None:
    """於 lifespan 啟動時呼叫,把 5 個 handler 訂閱到 event bus"""
    bus.subscribe(RegistrationCreated, _on_registration_created)
    bus.subscribe(LotteryCompleted, _on_lottery_completed)
    bus.subscribe(WaitlistPromoted, _on_waitlist_promoted)
    bus.subscribe(ConfirmationExpired, _on_confirmation_expired)
    bus.subscribe(EventCancelled, _on_event_cancelled)
    logger.info("notification_event_handlers_registered", count=5)
