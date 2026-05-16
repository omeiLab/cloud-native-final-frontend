"""notification 模組 API endpoints — 員工讀取站內通知 / 已讀標記

對齊設計 05 §12.1-12.4(對齊):
- GET /api/v1/notifications 站內通知列表(含 unread_count)
- GET /api/v1/notifications/unread-count 未讀計數 badge
- POST /api/v1/notifications/{id}/read 標記單筆已讀,回 {id, read_at}
- POST /api/v1/notifications/mark-all-read 全部標已讀,回 {updated_count}
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.core.db import get_ro_session, get_rw_session
from app.modules.auth.dependencies import CurrentUser, build_auth_service
from app.modules.notification.service import NotificationService
from app.shared.notification_ref import (
    MarkAllReadResult,
    MarkReadResult,
    NotificationListResponse,
    UnreadCount,
)

router = APIRouter()

_ULID_PATH = Path(min_length=26, max_length=26, pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")


async def get_rw_notification_service() -> AsyncIterator[NotificationService]:
    async for session in get_rw_session():
        yield NotificationService(session, build_auth_service(session))


async def get_ro_notification_service() -> AsyncIterator[NotificationService]:
    async for session in get_ro_session():
        yield NotificationService(session, build_auth_service(session))


RWNotificationServiceDep = Annotated[NotificationService, Depends(get_rw_notification_service)]
RONotificationServiceDep = Annotated[NotificationService, Depends(get_ro_notification_service)]


@router.get(
    "",
    response_model=NotificationListResponse,
    summary="我的站內通知列表(含 unread_count)",
)
async def list_my_notifications(
    user: CurrentUser,
    svc: RONotificationServiceDep,
    unread_only: Annotated[bool, Query(description="只看未讀")] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> NotificationListResponse:
    return await svc.list_in_app_notifications(
        user_id=user.id, unread_only=unread_only, page=page, page_size=page_size
    )


@router.get(
    "/unread-count",
    response_model=UnreadCount,
    summary="我的未讀計數(badge)",
)
async def get_my_unread_count(
    user: CurrentUser,
    svc: RONotificationServiceDep,
) -> UnreadCount:
    return await svc.get_unread_count(user.id)


@router.post(
    "/{notification_id}/read",
    response_model=MarkReadResult,
    summary="標記單筆站內通知為已讀(冪等;回 {id, read_at})",
)
async def mark_notification_read(
    notification_id: Annotated[str, _ULID_PATH],
    user: CurrentUser,
    svc: RWNotificationServiceDep,
) -> MarkReadResult:
    return await svc.mark_read(notification_id, user.id)


@router.post(
    "/mark-all-read",
    response_model=MarkAllReadResult,
    summary="把我所有未讀標為已讀",
)
async def mark_all_my_notifications_read(
    user: CurrentUser,
    svc: RWNotificationServiceDep,
) -> MarkAllReadResult:
    n = await svc.mark_all_read(user.id)
    return MarkAllReadResult(updated_count=n)


__all__ = ["router"]
