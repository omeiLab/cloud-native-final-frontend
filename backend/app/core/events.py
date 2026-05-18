"""In-process event bus — 對應設計 §5.5

跨模組事件用 Pub/Sub 模型解耦。 R6 後使用:registration / lottery /
ticket 模組 publish 事件 → notification 模組 subscribe + send_batch
(避免 caller 直接 import notification.service 違反 layer)。
"""

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class DomainEvent:
    """領域事件基底類別"""

    occurred_at: datetime = field(default_factory=lambda: datetime.now().astimezone())


# ─── 跨模組事件(:notification caller hooks) ───


@dataclass
class RegistrationCreated(DomainEvent):
    """員工成功報名 → REGISTRATION_CONFIRMED 通知"""

    registration_id: str = ""
    user_id: str = ""
    session_id: str = ""
    event_title: str = ""
    session_starts_at: str = "" # ISO string


@dataclass
class LotteryCompleted(DomainEvent):
    """單一票種抽籤完成 → 對 winners / waitlist / losers 各發通知"""

    session_id: str = ""
    ticket_type_id: str = ""
    event_title: str = ""
    confirmation_deadline: str = "" # ISO string
    winner_user_ids: list[str] = field(default_factory=list)
    waitlist_user_ids: list[str] = field(default_factory=list)
    loser_user_ids: list[str] = field(default_factory=list)


@dataclass
class WaitlistPromoted(DomainEvent):
    """候補遞補成功 → WAITLIST_PROMOTED 通知"""

    registration_id: str = ""
    user_id: str = ""
    session_id: str = ""
    event_title: str = ""
    confirmation_deadline: str = ""


@dataclass
class ConfirmationExpired(DomainEvent):
    """中籤者逾期未確認 → CONFIRMATION_EXPIRED 通知"""

    registration_id: str = ""
    user_id: str = ""
    event_title: str = ""
    deadline: str = ""


@dataclass
class EventCancelled(DomainEvent):
    """活動取消 → 對所有報名者發 EVENT_CANCELLED 通知"""

    event_id: str = ""
    event_title: str = ""
    reason: str = ""
    affected_user_ids: list[str] = field(default_factory=list)


EventHandler = Callable[[DomainEvent], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[type[DomainEvent], list[EventHandler]] = defaultdict(list)

    def subscribe(self, event_type: type[DomainEvent], handler: EventHandler) -> None:
        self._handlers[event_type].append(handler)
        logger.info("event_subscribed", event_name=event_type.__name__, handler=handler.__name__)

    async def publish(self, event: DomainEvent) -> None:
        handlers = self._handlers.get(type(event), [])
        if not handlers:
            return
        # 同步 publish,並行執行 handlers,失敗 log 不阻擋
        results: list[Any] = await asyncio.gather(
            *[self._safe_invoke(h, event) for h in handlers],
            return_exceptions=True,
        )
        for handler, result in zip(handlers, results, strict=True):
            if isinstance(result, Exception):
                logger.exception(
                    "event_handler_failed",
                    event_name=type(event).__name__,
                    handler=handler.__name__,
                    error=repr(result),
                )

    @staticmethod
    async def _safe_invoke(handler: EventHandler, event: DomainEvent) -> None:
        await handler(event)


event_bus = EventBus()
