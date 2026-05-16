"""AdminService unit tests — 跨模組聚合 + PII mask 流程"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.admin.errors import EventNotFoundError
from app.modules.admin.service import AdminService


def _user(uid: str = "u1", site: str = "HSINCHU", name: str = "王小明") -> SimpleNamespace:
    return SimpleNamespace(
        id=uid,
        employee_id=f"E{uid}",
        name=name,
        email=f"{uid}@example.com",
        department="研發部",
        site=site,
        role="EMPLOYEE",
        status="ACTIVE",
    )


def _reg(
    *,
    rid: str = "r1",
    user_id: str = "u1",
    session_id: str = "s1",
    ticket_type_id: str = "tt1",
    status: str = "REGISTERED",
    rank: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        user_id=user_id,
        session_id=session_id,
        ticket_type_id=ticket_type_id,
        status=status,
        lottery_rank=rank,
        waitlist_position=None,
        confirmation_deadline=None,
        confirmed_at=None,
        forfeited_at=None,
        cancelled_at=None,
        created_at=datetime(2026, 5, 4, tzinfo=UTC),
        updated_at=datetime(2026, 5, 4, tzinfo=UTC),
    )


def _session(sid: str = "s1", title: str = "上午場") -> SimpleNamespace:
    return SimpleNamespace(
        id=sid,
        title=title,
        starts_at=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
        ends_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        lottery_at=datetime(2026, 5, 25, tzinfo=UTC),
        status="REGISTRATION_OPEN",
        confirmation_deadline_hours=48,
        ticket_types=[SimpleNamespace(id="tt1", name="員工票", quota=200)],
    )


def _event(event_id: str = "e1") -> SimpleNamespace:
    return SimpleNamespace(
        id=event_id,
        title="2026 家庭日",
        sessions=[_session()],
        status="PUBLISHED",
    )


@pytest.fixture
def svc() -> AdminService:
    s = AdminService.__new__(AdminService)
    s.event_svc = AsyncMock()
    s.registration_svc = AsyncMock()
    s.ticket_svc = AsyncMock()
    s.auth_svc = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_cancel_event_chains_event_then_ticket_revoke(svc: AdminService) -> None:
    """ 全修:admin_svc.cancel_event 必須兩步呼叫
    1) event_svc.cancel_event 標 status=CANCELLED
    2) ticket_svc.revoke_tickets_by_event_cancelled 撤票 + publish EventCancelled

    第二步沒呼叫的話 → 持票員工不會收 EVENT_CANCELLED 通知 + ISSUED 票仍可被掃。
    """
    detail = SimpleNamespace(id="e1", status="CANCELLED")
    svc.event_svc.cancel_event = AsyncMock(return_value=detail)
    svc.ticket_svc.revoke_tickets_by_event_cancelled = AsyncMock(return_value=42)

    result = await svc.cancel_event(
        event_id="e1", actor_id="admin1", actor_role="ADMIN", reason="天候因素"
    )

    svc.event_svc.cancel_event.assert_awaited_once()
    svc.ticket_svc.revoke_tickets_by_event_cancelled.assert_awaited_once_with(
        event_id="e1", reason="天候因素", actor_id="admin1", actor_role="ADMIN"
    )
    assert result is detail


@pytest.mark.asyncio
async def test_cancel_event_passes_default_reason_when_none(svc: AdminService) -> None:
    """reason=None 時 ticket revoke 仍要傳一個有意義的 reason 字串(audit 可讀)"""
    svc.event_svc.cancel_event = AsyncMock(return_value=SimpleNamespace(id="e1"))
    svc.ticket_svc.revoke_tickets_by_event_cancelled = AsyncMock(return_value=0)

    await svc.cancel_event(event_id="e1", actor_id="a", actor_role="ADMIN", reason=None)
    kwargs = svc.ticket_svc.revoke_tickets_by_event_cancelled.await_args.kwargs
    assert kwargs["reason"] == "活動取消"


@pytest.mark.asyncio
async def test_get_site_employee_count_aggregates_total(svc: AdminService) -> None:
    svc.auth_svc.count_active_employees_by_sites = AsyncMock(
        return_value={"HSINCHU": 35420, "TAINAN": 28150}
    )
    result = await svc.get_site_employee_count(["HSINCHU", "TAINAN"])
    assert result.sites == {"HSINCHU": 35420, "TAINAN": 28150}
    assert result.total == 63570


@pytest.mark.asyncio
async def test_list_registrations_event_not_found_raises(svc: AdminService) -> None:
    svc.event_svc.get_event = AsyncMock(return_value=None)
    with pytest.raises(EventNotFoundError):
        await svc.list_event_registrations("01HBADXXXXXXXXXXXXXXXXXXXX")


@pytest.mark.asyncio
async def test_list_registrations_masks_pii_by_default(svc: AdminService) -> None:
    """mask_pii=True(預設):name → 中字遮罩、employee_id → 中段星號"""
    svc.event_svc.get_event = AsyncMock(return_value=_event())
    svc.registration_svc.list_by_session_ids_paged = AsyncMock(return_value=([_reg()], 1))
    svc.auth_svc.get_users_batch = AsyncMock(return_value=[_user()])

    result = await svc.list_event_registrations("e1")
    assert len(result.items) == 1
    item = result.items[0]
    assert item.user.name == "王*明" # 中字遮罩
    assert item.user.employee_id == "Eu*" # employee_id "Eu1" → 留前 2 + 1 個 *
    assert item.session_title == "上午場"
    assert item.ticket_type_name == "員工票"


@pytest.mark.asyncio
async def test_list_registrations_no_mask_keeps_raw(svc: AdminService) -> None:
    svc.event_svc.get_event = AsyncMock(return_value=_event())
    svc.registration_svc.list_by_session_ids_paged = AsyncMock(return_value=([_reg()], 1))
    svc.auth_svc.get_users_batch = AsyncMock(return_value=[_user()])

    result = await svc.list_event_registrations("e1", mask_pii=False)
    item = result.items[0]
    assert item.user.name == "王小明"
    assert item.user.employee_id == "Eu1"


@pytest.mark.asyncio
async def test_dashboard_aggregates_attendance_and_progress(svc: AdminService) -> None:
    svc.event_svc.get_event = AsyncMock(return_value=_event())
    svc.registration_svc.list_by_session = AsyncMock(
        return_value=[
            _reg(rid="r1", status="REGISTERED"),
            _reg(rid="r2", user_id="u2", status="WON", rank=1),
            _reg(rid="r3", user_id="u3", status="CONFIRMED"),
        ]
    )
    svc.auth_svc.get_users_batch = AsyncMock(
        return_value=[_user("u1"), _user("u2", site="TAINAN"), _user("u3")]
    )
    svc.ticket_svc.count_attendance = AsyncMock(
        return_value=SimpleNamespace(session_id="s1", issued=5, used=3, revoked=0)
    )

    result = await svc.dashboard if False else await svc.get_event_dashboard("e1")
    assert result.event_id == "e1"
    # ticket_type_progress
    tt = result.ticket_type_progress[0]
    assert tt.ticket_type_id == "tt1"
    assert tt.registered == 3 # 全部 3 筆
    assert tt.won == 2 # WON + CONFIRMED 都算
    assert tt.confirmed == 1 # 只 CONFIRMED
    # attendance
    assert result.attendance.checked_in == 3
    assert result.attendance.total_confirmed == 8 # issued + used


@pytest.mark.asyncio
async def test_dashboard_excludes_cancelled_from_registered_count(svc: AdminService) -> None:
    """ bug fix:CANCELLED 不應計入 registered / site / timeline。
    LOST / FORFEITED / EXPIRED 仍計入(曾經有效報過)。"""
    svc.event_svc.get_event = AsyncMock(return_value=_event())
    svc.registration_svc.list_by_session = AsyncMock(
        return_value=[
            _reg(rid="r1", user_id="u1", status="REGISTERED"),
            _reg(rid="r2", user_id="u2", status="WON", rank=1),
            _reg(rid="r3", user_id="u3", status="CANCELLED"), # 應排除
            _reg(rid="r4", user_id="u4", status="LOST"), # 應計入
            _reg(rid="r5", user_id="u5", status="FORFEITED"), # 應計入
        ]
    )
    svc.auth_svc.get_users_batch = AsyncMock(
        return_value=[_user("u1"), _user("u2"), _user("u4"), _user("u5")]
    )
    svc.ticket_svc.count_attendance = AsyncMock(
        return_value=SimpleNamespace(session_id="s1", issued=0, used=0, revoked=0)
    )

    result = await svc.get_event_dashboard("e1")
    tt = result.ticket_type_progress[0]
    assert tt.registered == 4 # 5 筆 - 1 CANCELLED
    # site_distribution 也應只 4 個(CANCELLED 的 u3 不在 user batch)
    site_total = sum(b.count for b in result.site_distribution)
    assert site_total == 4


@pytest.mark.asyncio
async def test_dashboard_event_not_found_raises(svc: AdminService) -> None:
    svc.event_svc.get_event = AsyncMock(return_value=None)
    with pytest.raises(EventNotFoundError):
        await svc.get_event_dashboard("ghost")
