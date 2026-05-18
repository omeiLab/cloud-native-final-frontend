"""event 模組 API endpoints — 員工 + 管理員兩組 router"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.core.db import get_ro_session, get_rw_session
from app.modules.auth.dependencies import CurrentUser, require_role
from app.modules.event.errors import EventNotFoundError
from app.modules.event.schemas import (
    CreateEventRequest,
    CreateSessionRequest,
    CreateTicketTypeRequest,
    UpdateEventRequest,
    UpdateSessionRequest,
)
from app.modules.event.service import EventService
from app.shared.enums import Role
from app.shared.event_ref import EventDetail, EventSummary, SessionInfo, TicketTypeInfo
from app.shared.pagination import PagedResult

employee_router = APIRouter()
admin_router = APIRouter()


async def get_ro_event_service() -> AsyncIterator[EventService]:
    """讀路徑:打 CNPG ro endpoint(replica)"""
    async for session in get_ro_session():
        yield EventService(session)


async def get_rw_event_service() -> AsyncIterator[EventService]:
    """寫路徑(含 cancel/publish/update):打 CNPG rw endpoint(primary)"""
    async for session in get_rw_session():
        yield EventService(session)


ROEventServiceDep = Annotated[EventService, Depends(get_ro_event_service)]
RWEventServiceDep = Annotated[EventService, Depends(get_rw_event_service)]


# Employee endpoints — /api/v1/events/*


@employee_router.get(
    "",
    response_model=PagedResult[EventSummary],
    summary="活動列表(預設僅顯示員工所屬廠區開放的活動)",
)
async def list_events(
    user: CurrentUser,
    svc: ROEventServiceDep,
    scope: Annotated[str, Query(pattern="^(eligible|all)$")] = "eligible",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PagedResult[EventSummary]:
    items, total = await svc.list_published_for_employee(
        user_site=user.site, scope=scope, page=page, page_size=page_size
    )
    return PagedResult[EventSummary].build(items, page=page, page_size=page_size, total=total)


@employee_router.get(
    "/{event_id}",
    response_model=EventDetail,
    summary="活動詳情(含所有場次與票種)",
)
async def get_event(
    event_id: Annotated[str, Path(min_length=26, max_length=26)],
    user: CurrentUser,
    svc: ROEventServiceDep,
) -> EventDetail:
    detail = await svc.get_event_detail_for_employee(event_id, user.site)
    if detail is None:
        raise EventNotFoundError("活動不存在")
    return detail


# Admin endpoints — /api/v1/admin/events/*


@admin_router.get(
    "/events",
    response_model=PagedResult[EventSummary],
    summary="admin 列活動(可選 status filter:DRAFT / PUBLISHED / CANCELLED)",
)
async def list_admin_events(
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: ROEventServiceDep,
    event_status: Annotated[
        str | None, Query(pattern="^(DRAFT|PUBLISHED|CANCELLED)$", alias="status")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PagedResult[EventSummary]:
    """:草稿管理 — `?status=DRAFT` 列出所有草稿;不帶 status 列全部。
    跟 employee `GET /events` 的差異:無廠區過濾、含 DRAFT / CANCELLED。"""
    items, total = await svc.list_for_admin(
        actor_role=admin.role, status=event_status, page=page, page_size=page_size
    )
    return PagedResult[EventSummary].build(items, page=page, page_size=page_size, total=total)


@admin_router.get(
    "/events/{event_id}",
    response_model=EventDetail,
    summary="admin 看活動詳情(不限 status,可看 DRAFT)",
)
async def get_admin_event(
    event_id: Annotated[str, Path(min_length=26, max_length=26)],
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: ROEventServiceDep,
) -> EventDetail:
    detail = await svc.get_event_detail_for_admin(event_id, actor_role=admin.role)
    if detail is None:
        raise EventNotFoundError("活動不存在")
    return detail


@admin_router.post(
    "/events",
    response_model=EventDetail,
    status_code=status.HTTP_201_CREATED,
    summary="建立活動(草稿)",
)
async def create_event(
    body: CreateEventRequest,
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> EventDetail:
    request_id = getattr(request.state, "request_id", None)
    return await svc.create_event(
        actor_id=admin.id,
        actor_role=admin.role,
        title=body.title,
        description=body.description,
        cover_image_url=body.cover_image_url,
        allowed_sites=body.allowed_sites,
        request_id=request_id,
    )


@admin_router.patch(
    "/events/{event_id}",
    response_model=EventDetail,
    summary="編輯活動;BR-11:發布後 allowed_sites 不可改",
)
async def update_event(
    event_id: Annotated[str, Path(min_length=26, max_length=26)],
    body: UpdateEventRequest,
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> EventDetail:
    request_id = getattr(request.state, "request_id", None)
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    return await svc.update_event(
        event_id=event_id,
        actor_id=admin.id,
        actor_role=admin.role,
        fields=fields,
        request_id=request_id,
    )


@admin_router.post(
    "/events/{event_id}/publish",
    response_model=EventDetail,
    summary="發布活動(DRAFT → PUBLISHED)",
)
async def publish_event(
    event_id: Annotated[str, Path(min_length=26, max_length=26)],
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> EventDetail:
    request_id = getattr(request.state, "request_id", None)
    return await svc.publish_event(
        event_id=event_id,
        actor_id=admin.id,
        actor_role=admin.role,
        request_id=request_id,
    )


# 全修:cancel endpoint 搬到 admin/api.py(admin_svc 統籌 event + ticket
# 撤銷與通知,因為 layer event 不能 import ticket)。
# admin endpoint mount 在同一 /api/v1/admin/events/{id}/cancel path,前端不需改。


@admin_router.patch(
    "/sessions/{session_id}",
    response_model=SessionInfo,
    summary="更新場次欄位(時間、場地、提前關閉報名)— ADMIN",
)
async def update_session(
    session_id: Annotated[str, Path(min_length=26, max_length=26)],
    body: UpdateSessionRequest,
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> SessionInfo:
    """寫入後 evict session + event cache,避免 60s TTL 內驗票讀到舊
    starts_at(對齊設計 §10.7 BR-07 核銷時段)。狀態僅允許手動關閉報名。"""
    request_id = getattr(request.state, "request_id", None)
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    return await svc.update_session(
        session_id=session_id,
        actor_id=admin.id,
        actor_role=admin.role,
        fields=fields,
        request_id=request_id,
    )


@admin_router.post(
    "/events/{event_id}/sessions",
    response_model=SessionInfo,
    status_code=status.HTTP_201_CREATED,
    summary="新增場次",
)
async def create_session(
    event_id: Annotated[str, Path(min_length=26, max_length=26)],
    body: CreateSessionRequest,
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> SessionInfo:
    request_id = getattr(request.state, "request_id", None)
    return await svc.add_session(
        event_id=event_id,
        actor_id=admin.id,
        actor_role=admin.role,
        title=body.title,
        venue=body.venue,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        registration_opens_at=body.registration_opens_at,
        registration_closes_at=body.registration_closes_at,
        lottery_at=body.lottery_at,
        waitlist_close_at=body.waitlist_close_at,
        confirmation_deadline_hours=body.confirmation_deadline_hours,
        request_id=request_id,
    )


@admin_router.post(
    "/sessions/{session_id}/ticket-types",
    response_model=TicketTypeInfo,
    status_code=status.HTTP_201_CREATED,
    summary="新增票種",
)
async def create_ticket_type(
    session_id: Annotated[str, Path(min_length=26, max_length=26)],
    body: CreateTicketTypeRequest,
    request: Request,
    admin: Annotated[CurrentUser, Depends(require_role(Role.ADMIN))],
    svc: RWEventServiceDep,
) -> TicketTypeInfo:
    request_id = getattr(request.state, "request_id", None)
    return await svc.add_ticket_type(
        session_id=session_id,
        actor_id=admin.id,
        actor_role=admin.role,
        name=body.name,
        quota=body.quota,
        sort_order=body.sort_order,
        audience=body.audience,
        request_id=request_id,
    )
