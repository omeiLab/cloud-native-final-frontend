"""registration 模組 API endpoints — 員工自己的報名 CRUD + 我的報名清單

:
- create_registration 接 as_dependent_id(代報);ownership 由 service 層驗
- list_my_registrations 預設 UNION 員工自己 + 所有眷屬 reg(by service)
- service 注入 auth_svc 給 ownership / 代報眷屬解析用
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.core.db import get_ro_session, get_rw_session
from app.core.middleware import get_client_meta
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.service import AuthService
from app.modules.event.service import EventService
from app.modules.registration.schemas import CreateRegistrationRequest
from app.modules.registration.service import RegistrationService
from app.shared.enums import RegistrationStatus
from app.shared.pagination import PagedResult
from app.shared.registration_ref import RegistrationDetail

router = APIRouter()
me_router = APIRouter()


async def get_rw_registration_service() -> AsyncIterator[RegistrationService]:
    async for session in get_rw_session():
        event_svc = EventService(session)
        auth_svc = AuthService(session)
        yield RegistrationService(session, event_svc, auth_svc=auth_svc)


async def get_ro_registration_service() -> AsyncIterator[RegistrationService]:
    async for session in get_ro_session():
        event_svc = EventService(session)
        auth_svc = AuthService(session)
        yield RegistrationService(session, event_svc, auth_svc=auth_svc)


RWRegistrationServiceDep = Annotated[RegistrationService, Depends(get_rw_registration_service)]
RORegistrationServiceDep = Annotated[RegistrationService, Depends(get_ro_registration_service)]


# /api/v1/registrations


_ULID_PATH = Path(min_length=26, max_length=26, pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")


@router.post(
    "",
    response_model=RegistrationDetail,
    status_code=status.HTTP_201_CREATED,
    summary="送出報名(廠區 + 報名期間驗證); 可代報眷屬(as_dependent_id)",
)
async def create_registration(
    body: CreateRegistrationRequest,
    request: Request,
    user: CurrentUser,
    svc: RWRegistrationServiceDep,
) -> RegistrationDetail:
    request_id, ip, ua = get_client_meta(request)
    return await svc.create(
        user_id=user.id,
        user_site=user.site,
        user_role=user.role,
        session_id=body.session_id,
        ticket_type_id=body.ticket_type_id,
        as_dependent_id=body.as_dependent_id,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@router.delete(
    "/{registration_id}",
    response_model=RegistrationDetail,
    summary="取消報名(對齊設計 05 §9.4 — 僅 REGISTERED 狀態;抽籤後改用 forfeit)",
)
async def cancel_registration(
    registration_id: Annotated[str, _ULID_PATH],
    request: Request,
    user: CurrentUser,
    svc: RWRegistrationServiceDep,
) -> RegistrationDetail:
    request_id, ip, ua = get_client_meta(request)
    return await svc.cancel(
        registration_id=registration_id,
        user_id=user.id,
        user_role=user.role,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@router.post(
    "/{registration_id}/forfeit",
    response_model=RegistrationDetail,
    summary="中籤後棄權,觸發候補遞補",
)
async def forfeit_registration(
    registration_id: Annotated[str, _ULID_PATH],
    request: Request,
    user: CurrentUser,
    svc: RWRegistrationServiceDep,
) -> RegistrationDetail:
    request_id, ip, ua = get_client_meta(request)
    return await svc.forfeit(
        registration_id=registration_id,
        user_id=user.id,
        user_role=user.role,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


# /api/v1/me/registrations


@me_router.get(
    "/registrations",
    response_model=PagedResult[RegistrationDetail],
    summary="我的報名清單(:UNION 自己 + 所有眷屬,as_dependent_id 標示)",
)
async def list_my_registrations(
    user: CurrentUser,
    svc: RORegistrationServiceDep,
    status_filter: Annotated[
        list[RegistrationStatus] | None,
        Query(alias="status", description="可重複帶,過濾多個狀態"),
    ] = None,
    time_filter: Annotated[
        str,
        Query(
            alias="time_filter",
            pattern="^(upcoming|past|all)$",
            description="upcoming = 未來場次;past = 已結束;all = 全部",
        ),
    ] = "all",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PagedResult[RegistrationDetail]:
    items, total = await svc.list_my_registrations(
        user_id=user.id,
        status_filter=[s.value for s in status_filter] if status_filter else None,
        time_filter=time_filter,
        page=page,
        page_size=page_size,
    )
    return PagedResult[RegistrationDetail].build(items, page=page, page_size=page_size, total=total)
