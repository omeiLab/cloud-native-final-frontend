"""check_eligibility 邊界測試 — 對齊設計 §4.2(空 allowed_sites 視同全廠區)"""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.time import now_utc
from app.modules.event.errors import EventNotFoundError, SessionNotFoundError
from app.modules.event.service import EventService
from app.shared.enums import SessionStatus


def _make_session(
    *,
    status: str = "REGISTRATION_OPEN",
    open_offset_min: int = -10,
    close_offset_min: int = 60,
):
    now = now_utc()
    return SimpleNamespace(
        id="01H8XXXXXXXXXXXXXXXXXXXXXX",
        event_id="01H8YYYYYYYYYYYYYYYYYYYYYY",
        title="上午場",
        venue="新竹棒球場",
        starts_at=now + timedelta(days=10),
        ends_at=now + timedelta(days=10, hours=3),
        registration_opens_at=now + timedelta(minutes=open_offset_min),
        registration_closes_at=now + timedelta(minutes=close_offset_min),
        lottery_at=now + timedelta(minutes=close_offset_min + 30),
        waitlist_close_at=now + timedelta(days=8),
        confirmation_deadline_hours=48,
        status=status,
        lottery_executed_at=None,
    )


def _make_event(allowed_sites: list[str], status: str = "PUBLISHED"):
    return SimpleNamespace(
        id="01H8YYYYYYYYYYYYYYYYYYYYYY",
        title="家庭日",
        status=status,
        allowed_sites=allowed_sites,
    )


@pytest.fixture
def svc(monkeypatch):
    s = EventService.__new__(EventService)
    s.session = AsyncMock()
    s.session_repo = AsyncMock()
    s.event_repo = AsyncMock()
    s.ticket_type_repo = AsyncMock()
    s.ticket_type_repo.list_by_session = AsyncMock(return_value=[])
    return s


@pytest.mark.asyncio
async def test_eligible_when_site_in_allowed_list(svc):
    svc.session_repo.get_by_id = AsyncMock(return_value=_make_session())
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event(["HSINCHU"]))

    result = await svc.check_eligibility("HSINCHU", "session-id")
    assert result.eligible is True
    assert result.reason is None


@pytest.mark.asyncio
async def test_eligible_when_allowed_sites_empty_means_all(svc):
    """設計 §4.2:空 allowed_sites 視同全廠區開放"""
    svc.session_repo.get_by_id = AsyncMock(return_value=_make_session())
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event([]))

    result = await svc.check_eligibility("OVERSEAS", "session-id")
    assert result.eligible is True


@pytest.mark.asyncio
async def test_ineligible_when_site_not_in_allowed_list(svc):
    svc.session_repo.get_by_id = AsyncMock(return_value=_make_session())
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event(["HSINCHU", "TAINAN"]))

    result = await svc.check_eligibility("TAIPEI", "session-id")
    assert result.eligible is False
    assert "HSINCHU" in (result.reason or "")
    assert "TAINAN" in (result.reason or "")


@pytest.mark.asyncio
async def test_ineligible_when_registration_not_yet_open(svc):
    svc.session_repo.get_by_id = AsyncMock(
        return_value=_make_session(open_offset_min=60) # 60 分鐘後才開放
    )
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event([]))

    result = await svc.check_eligibility("HSINCHU", "session-id")
    assert result.eligible is False
    assert "尚未開放" in (result.reason or "")


@pytest.mark.asyncio
async def test_ineligible_when_registration_closed(svc):
    svc.session_repo.get_by_id = AsyncMock(
        return_value=_make_session(close_offset_min=-10) # 10 分鐘前已截止
    )
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event([]))

    result = await svc.check_eligibility("HSINCHU", "session-id")
    assert result.eligible is False
    assert "截止" in (result.reason or "")


@pytest.mark.asyncio
async def test_ineligible_when_session_status_not_open(svc):
    svc.session_repo.get_by_id = AsyncMock(return_value=_make_session(status="LOTTERY_RUNNING"))
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event([]))

    result = await svc.check_eligibility("HSINCHU", "session-id")
    assert result.eligible is False
    assert result.session_status == SessionStatus.LOTTERY_RUNNING


@pytest.mark.asyncio
async def test_raises_when_session_not_found(svc):
    svc.session_repo.get_by_id = AsyncMock(return_value=None)
    with pytest.raises(SessionNotFoundError):
        await svc.check_eligibility("HSINCHU", "missing")


@pytest.mark.asyncio
async def test_raises_when_event_unpublished(svc):
    svc.session_repo.get_by_id = AsyncMock(return_value=_make_session())
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event([], status="DRAFT"))
    with pytest.raises(EventNotFoundError):
        await svc.check_eligibility("HSINCHU", "session-id")
