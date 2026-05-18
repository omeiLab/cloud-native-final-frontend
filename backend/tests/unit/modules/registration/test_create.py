"""report create() 流程 — eligibility + uniq 防重複"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.registration.errors import (
    AlreadyRegisteredError,
    IneligibleError,
    RegistrationClosedError,
)
from app.modules.registration.service import RegistrationService
from app.shared.enums import EligibilityReason, SessionStatus
from app.shared.event_ref import EligibilityResult, TicketTypeInfo


def _eligible() -> EligibilityResult:
    return EligibilityResult(
        eligible=True,
        user_site="HSINCHU",
        allowed_sites=["HSINCHU"],
        session_status=SessionStatus.REGISTRATION_OPEN,
    )


def _ticket_type(session_id: str) -> TicketTypeInfo:
    return TicketTypeInfo(
        id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        session_id=session_id,
        name="一般票",
        quota=10,
        sort_order=0,
    )


def _make_registration(reg_id: str = "01HRGXXXXXXXXXXXXXXXXXXXXX") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=reg_id,
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        status="REGISTERED",
        lottery_rank=None,
        waitlist_position=None,
        confirmation_deadline=None,
        confirmed_at=None,
        forfeited_at=None,
        cancelled_at=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_create_succeeds_when_eligible(svc: RegistrationService) -> None:
    svc.event_svc.check_eligibility = AsyncMock(return_value=_eligible())
    svc.event_svc.get_ticket_type = AsyncMock(
        return_value=_ticket_type("01HSESSXXXXXXXXXXXXXXXXXXX")
    )
    svc.repo.create = AsyncMock(return_value=_make_registration())

    result = await svc.create(
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        user_site="HSINCHU",
        user_role="EMPLOYEE",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
    )
    assert result.status == "REGISTERED"
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_create_raises_ineligible_when_site_mismatch(svc: RegistrationService) -> None:
    svc.event_svc.check_eligibility = AsyncMock(
        return_value=EligibilityResult(
            eligible=False,
            reason="本活動僅限 HSINCHU 廠區員工報名",
            reason_code=EligibilityReason.SITE_MISMATCH,
            user_site="TAIPEI",
            allowed_sites=["HSINCHU"],
            session_status=SessionStatus.REGISTRATION_OPEN,
        )
    )
    with pytest.raises(IneligibleError):
        await svc.create(
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_site="TAIPEI",
            user_role="EMPLOYEE",
            session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
            ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        )


@pytest.mark.asyncio
async def test_create_raises_closed_when_registration_closed(svc: RegistrationService) -> None:
    svc.event_svc.check_eligibility = AsyncMock(
        return_value=EligibilityResult(
            eligible=False,
            reason="報名已截止",
            reason_code=EligibilityReason.REGISTRATION_CLOSED,
            user_site="HSINCHU",
            allowed_sites=[],
            session_status=SessionStatus.REGISTRATION_CLOSED,
        )
    )
    with pytest.raises(RegistrationClosedError):
        await svc.create(
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_site="HSINCHU",
            user_role="EMPLOYEE",
            session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
            ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        )


@pytest.mark.asyncio
async def test_create_raises_when_ticket_type_not_in_session(svc: RegistrationService) -> None:
    """票種屬於別場次 → 防 user 偽造 ticket_type_id"""
    svc.event_svc.check_eligibility = AsyncMock(return_value=_eligible())
    svc.event_svc.get_ticket_type = AsyncMock(return_value=_ticket_type("OTHER_SESSION"))

    with pytest.raises(RegistrationClosedError):
        await svc.create(
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_site="HSINCHU",
            user_role="EMPLOYEE",
            session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
            ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        )


@pytest.mark.asyncio
async def test_create_propagates_already_registered(svc: RegistrationService) -> None:
    """repo.create 撞 UNIQUE 拋 AlreadyRegisteredError 透傳"""
    svc.event_svc.check_eligibility = AsyncMock(return_value=_eligible())
    svc.event_svc.get_ticket_type = AsyncMock(
        return_value=_ticket_type("01HSESSXXXXXXXXXXXXXXXXXXX")
    )
    svc.repo.create = AsyncMock(side_effect=AlreadyRegisteredError("您已報名此場次"))

    with pytest.raises(AlreadyRegisteredError):
        await svc.create(
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_site="HSINCHU",
            user_role="EMPLOYEE",
            session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
            ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        )
