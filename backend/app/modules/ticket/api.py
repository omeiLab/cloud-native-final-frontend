"""ticket 模組 API endpoints — 員工 confirm/領票/拿 QR + 驗票員核銷"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.config import settings
from app.core.db import get_ro_session, get_rw_session
from app.core.exceptions import ForbiddenError
from app.core.middleware import get_client_meta
from app.core.qr_signer import QRSigner, get_qr_signer
from app.core.rate_limit import check_rate_limit
from app.modules.auth.dependencies import CurrentUser, require_role
from app.modules.auth.service import AuthService
from app.modules.event.service import EventService
from app.modules.registration.service import RegistrationService
from app.modules.ticket.schemas import VerifyTicketRequest
from app.modules.ticket.service import TicketService
from app.shared.enums import Role, TicketStatus
from app.shared.pagination import PagedResult
from app.shared.ticket_ref import (
    TicketDetail,
    TicketSummary,
    TicketWithQRPayload,
    VerificationResult,
)

confirm_router = APIRouter()
me_router = APIRouter()
verify_router = APIRouter()

_ULID_PATH = Path(min_length=26, max_length=26, pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")


async def get_rw_ticket_service() -> AsyncIterator[TicketService]:
    async for session in get_rw_session():
        event_svc = EventService(session)
        auth_svc = AuthService(session)
        reg_svc = RegistrationService(session, event_svc, auth_svc=auth_svc)
        yield TicketService(session, event_svc, reg_svc, get_qr_signer(), auth_svc=auth_svc)


async def get_ro_ticket_service() -> AsyncIterator[TicketService]:
    async for session in get_ro_session():
        event_svc = EventService(session)
        auth_svc = AuthService(session)
        reg_svc = RegistrationService(session, event_svc, auth_svc=auth_svc)
        yield TicketService(session, event_svc, reg_svc, get_qr_signer(), auth_svc=auth_svc)


RWTicketServiceDep = Annotated[TicketService, Depends(get_rw_ticket_service)]
ROTicketServiceDep = Annotated[TicketService, Depends(get_ro_ticket_service)]


# 員工:確認中籤 + 領票


@confirm_router.post(
    "/{registration_id}/confirm",
    response_model=TicketDetail,
    summary="確認中籤並發票券(WON → CONFIRMED + INSERT ticket; reg/ticket 1:1)",
    status_code=status.HTTP_201_CREATED,
)
async def confirm_registration(
    registration_id: Annotated[str, _ULID_PATH],
    request: Request,
    user: CurrentUser,
    svc: RWTicketServiceDep,
) -> TicketDetail:
    request_id, ip, ua = get_client_meta(request)
    return await svc.confirm_registration_and_issue_ticket(
        registration_id=registration_id,
        user_id=user.id,
        user_role=user.role,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


# 員工:我的票券 + QR


@me_router.get(
    "/tickets",
    response_model=PagedResult[TicketSummary],
    summary="我的票券清單",
)
async def list_my_tickets(
    user: CurrentUser,
    svc: ROTicketServiceDep,
    status_filter: Annotated[
        TicketStatus | None,
        Query(alias="status"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PagedResult[TicketSummary]:
    items, total = await svc.list_tickets_by_user(
        user_id=user.id,
        status=status_filter.value if status_filter else None,
        page=page,
        page_size=page_size,
    )
    return PagedResult[TicketSummary].build(items, page=page, page_size=page_size, total=total)


@me_router.get(
    "/tickets/{ticket_id}/qr",
    response_model=TicketWithQRPayload,
    summary="拿票券 + 當下產 QR JWT(EdDSA,60 秒過期)",
)
async def get_ticket_qr(
    ticket_id: Annotated[str, _ULID_PATH],
    user: CurrentUser,
    svc: ROTicketServiceDep,
) -> TicketWithQRPayload:
    return await svc.get_ticket_with_qr(ticket_id, user.id)


# 驗票員:核銷


def _parse_device_allowlist() -> set[str]:
    """設定字串 → set;空字串/全空白視為 lab 模式不啟用"""
    raw = (settings.ticket_verify_device_allowlist or "").strip()
    if not raw:
        return set()
    return {d.strip() for d in raw.split(",") if d.strip()}


@verify_router.post(
    "/ticket",
    response_model=VerificationResult,
    summary="驗票員 scanner 掃描 QR 後核銷(BR-07 30 分鐘窗)",
)
async def verify_ticket(
    body: VerifyTicketRequest,
    request: Request,
    verifier: Annotated[CurrentUser, Depends(require_role(Role.VERIFIER))],
    svc: RWTicketServiceDep,
) -> VerificationResult:
    request_id, _ip, _ua = get_client_meta(request)
    #:device 白名單(lab 階段空字串=不啟用;production 必補)
    allowlist = _parse_device_allowlist()
    if allowlist and body.device_id not in allowlist:
        raise ForbiddenError(
            f"驗票裝置 {body.device_id} 不在白名單內",
            details={"device_id": body.device_id},
        )
    #:per (verifier, device) 60/min 防暴力 / token 流出
    await check_rate_limit(
        key=f"verify:{verifier.id}:{body.device_id}",
        limit=settings.ticket_verify_rate_per_minute,
        window_seconds=60,
    )
    return await svc.verify_and_use_ticket(
        qr_payload=body.qr_payload,
        device_id=body.device_id,
        verifier_id=verifier.id,
        request_id=request_id,
    )


# 暴露給 main.py 的 wire helper(避免 main.py 直接 import 太多)
__all__ = [
    "QRSigner", # re-export 方便 main.py wire qr_signer 啟動驗證
    "confirm_router",
    "me_router",
    "verify_router",
]
