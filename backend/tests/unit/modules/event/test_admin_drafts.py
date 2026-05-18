"""admin draft list / detail — 草稿管理 API

驗:
- list_for_admin status=DRAFT 只回 DRAFT
- list_for_admin status=None 回全部
- list_for_admin actor_role=EMPLOYEE → ForbiddenError(RBAC 守衛)
- get_event_detail_for_admin 可看 DRAFT(employee 路徑 PUBLISHED-only)
- get_event_detail_for_admin actor_role=EMPLOYEE → ForbiddenError
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ForbiddenError
from app.modules.event.service import EventService


def _ev(eid: str, status: str, title: str = "活動") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=eid,
        title=title,
        description=None,
        cover_image_url=None,
        status=status,
        allowed_sites=[],
        created_by="01HADMINXXXXXXXXXXXXXXXXXX",
        created_at=now,
        updated_at=now,
        cancelled_at=None,
    )


@pytest.fixture
def svc() -> EventService:
    s = EventService.__new__(EventService)
    s.session = AsyncMock()
    s.session_repo = AsyncMock()
    s.event_repo = AsyncMock()
    s.ticket_type_repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_list_for_admin_filters_by_status(svc: EventService) -> None:
    draft = _ev("01HD1XXXXXXXXXXXXXXXXXXXXX", "DRAFT", "草稿活動")
    svc.event_repo.list_admin = AsyncMock(return_value=([draft], 1))
    svc.session_repo.list_by_event = AsyncMock(return_value=[])

    items, total = await svc.list_for_admin(actor_role="ADMIN", status="DRAFT")

    assert total == 1
    assert items[0].id == "01HD1XXXXXXXXXXXXXXXXXXXXX"
    assert items[0].status == "DRAFT"
    svc.event_repo.list_admin.assert_awaited_once_with(status="DRAFT", page=1, page_size=20)


@pytest.mark.asyncio
async def test_list_for_admin_no_status_returns_all(svc: EventService) -> None:
    svc.event_repo.list_admin = AsyncMock(
        return_value=(
            [
                _ev("01HD1XXXXXXXXXXXXXXXXXXXXX", "DRAFT"),
                _ev("01HP1XXXXXXXXXXXXXXXXXXXXX", "PUBLISHED"),
            ],
            2,
        )
    )
    svc.session_repo.list_by_event = AsyncMock(return_value=[])

    items, total = await svc.list_for_admin(actor_role="ADMIN")

    assert total == 2
    assert {i.status for i in items} == {"DRAFT", "PUBLISHED"}
    svc.event_repo.list_admin.assert_awaited_once_with(status=None, page=1, page_size=20)


@pytest.mark.asyncio
async def test_list_for_admin_employee_blocked(svc: EventService) -> None:
    with pytest.raises(ForbiddenError):
        await svc.list_for_admin(actor_role="EMPLOYEE")


@pytest.mark.asyncio
async def test_get_event_detail_for_admin_sees_draft(svc: EventService) -> None:
    svc.event_repo.get_by_id = AsyncMock(return_value=_ev("01HD1XXXXXXXXXXXXXXXXXXXXX", "DRAFT"))
    svc.session_repo.list_by_event = AsyncMock(return_value=[])

    detail = await svc.get_event_detail_for_admin("01HD1XXXXXXXXXXXXXXXXXXXXX", actor_role="ADMIN")
    assert detail is not None
    assert detail.status == "DRAFT"


@pytest.mark.asyncio
async def test_get_event_detail_for_admin_employee_blocked(svc: EventService) -> None:
    with pytest.raises(ForbiddenError):
        await svc.get_event_detail_for_admin("01HD1XXXXXXXXXXXXXXXXXXXXX", actor_role="EMPLOYEE")


@pytest.mark.asyncio
async def test_get_event_detail_for_admin_not_found(svc: EventService) -> None:
    svc.event_repo.get_by_id = AsyncMock(return_value=None)
    detail = await svc.get_event_detail_for_admin("01HX1XXXXXXXXXXXXXXXXXXXXX", actor_role="ADMIN")
    assert detail is None
