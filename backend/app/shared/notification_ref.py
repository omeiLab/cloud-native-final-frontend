"""跨模組共用 Notification DTO(對齊設計 06 §11 + 05 §12)"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.shared.enums import NotificationChannel, NotificationStatus


class NotificationDetail(BaseModel):
    """通知完整資訊(admin 用、含 status / channel / sent_at)"""

    model_config = ConfigDict(frozen=True)

    id: str
    user_id: str
    channel: NotificationChannel
    type: str
    title: str
    body: str
    payload: dict[str, Any]
    status: NotificationStatus
    sent_at: datetime | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationItem(BaseModel):
    """員工站內通知列表 item — 對齊設計 05 §12.1 範例(:補 body/payload)"""

    model_config = ConfigDict(frozen=True)

    id: str
    type: str
    title: str
    body: str
    payload: dict[str, Any]
    read_at: datetime | None = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    """`GET /api/v1/notifications` 回傳(對齊設計 05 §12.1 包 unread_count)"""

    model_config = ConfigDict(frozen=True)

    items: list[NotificationItem]
    total: int
    unread_count: int
    page: int
    page_size: int
    has_next: bool


class UnreadCount(BaseModel):
    """`GET /api/v1/notifications/unread-count`(設計 05 §12.4)"""

    model_config = ConfigDict(frozen=True)

    unread_count: int


class MarkReadResult(BaseModel):
    """`POST /api/v1/notifications/{id}/read` 回傳(設計 05 §12.2)"""

    model_config = ConfigDict(frozen=True)

    id: str
    read_at: datetime


class MarkAllReadResult(BaseModel):
    """`POST /api/v1/notifications/mark-all-read` 回傳(設計 05 §12.3)"""

    model_config = ConfigDict(frozen=True)

    updated_count: int
