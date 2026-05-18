"""execute_lottery 流程 — 冪等(走 race fallback)+ happy path + 邊界

 後流程改為:直接 try create_record_or_raise → IntegrityError 後 rollback
+ get_record fallback,移除預檢 query。Happy path 用 session.refresh 取代 final reload。
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.lottery.errors import LotteryAlreadyExecutedError, SessionNotFoundError
from app.modules.lottery.service import LotteryService


def _session_info(
    session_id: str = "01HSESSXXXXXXXXXXXXXXXXXXX",
    status: str = "REGISTRATION_CLOSED",
    quotas: list[tuple[str, int]] | None = None,
) -> SimpleNamespace:
    if quotas is None:
        quotas = [("01HTT1XXXXXXXXXXXXXXXXXXXX", 3)]
    return SimpleNamespace(
        id=session_id,
        status=status,
        confirmation_deadline_hours=48,
        ticket_types=[SimpleNamespace(id=tt_id, quota=q) for tt_id, q in quotas],
    )


def _record(
    *,
    candidate_count: int = 5,
    winner_count: int = 3,
    waitlist_count: int = 2,
    status: str = "COMPLETED",
) -> SimpleNamespace:
    return SimpleNamespace(
        id="01HRECXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTT1XXXXXXXXXXXXXXXXXXXX",
        seed="a" * 64,
        candidate_count=candidate_count,
        winner_count=winner_count,
        waitlist_count=waitlist_count,
        algorithm_version="fisher-yates-v2-independent",
        status=status,
        quota_at_draw=3,
        emp_remaining_allocated=0,
        executed_at=datetime.now(UTC),
        duration_ms=42,
    )


@pytest.mark.asyncio
async def test_session_not_found_raises_business_error(svc: LotteryService) -> None:
    """設計 §9.7:找不到 session 應 raise SessionNotFoundError(BusinessError),非 ValueError"""
    svc.event_svc.get_session = AsyncMock(return_value=None)
    with pytest.raises(SessionNotFoundError):
        await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")


@pytest.mark.asyncio
async def test_idempotent_returns_existing_record(svc: LotteryService) -> None:
    """同 session+ticket_type 已抽過 → create raise → rollback → 撈現有紀錄回"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    existing = _record()
    svc.repo.create_record_or_raise = AsyncMock(side_effect=LotteryAlreadyExecutedError("dup"))
    svc.repo.get_record = AsyncMock(return_value=existing)

    result = await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")

    assert len(result.ticket_types) == 1
    assert result.ticket_types[0].newly_executed is False
    svc.session.rollback.assert_awaited() # IntegrityError 後必 rollback
    svc.registration_svc.apply_lottery_results.assert_not_called()


@pytest.mark.asyncio
async def test_already_completed_session_skips_state_marks(svc: LotteryService) -> None:
    """場次已 LOTTERY_COMPLETED → 不再 mark_running/completed,直接 idempotent 走 race fallback"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info(status="LOTTERY_COMPLETED"))
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(side_effect=LotteryAlreadyExecutedError("dup"))
    svc.repo.get_record = AsyncMock(return_value=_record())

    await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")

    svc.event_svc.mark_lottery_running.assert_not_called()
    svc.event_svc.mark_lottery_completed.assert_not_called()


@pytest.mark.asyncio
async def test_happy_path_creates_record_and_applies_results(
    svc: LotteryService,
) -> None:
    """新場次:create_record(success)→ fetch candidates → shuffle → apply → refresh"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    record = _record()
    svc.repo.create_record_or_raise = AsyncMock(return_value=record)
    svc.repo.update_record_counts = AsyncMock()
    svc.session.refresh = AsyncMock() # R3 fix:用 refresh 取代 final get_record
    candidates = [SimpleNamespace(id=f"01HC{i:022d}") for i in range(5)]
    svc.registration_svc.list_registered_for_lottery = AsyncMock(return_value=candidates)
    svc.registration_svc.apply_lottery_results = AsyncMock()

    result = await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")

    assert result.ticket_types[0].newly_executed is True
    svc.event_svc.mark_lottery_running.assert_called_once()
    svc.event_svc.mark_lottery_completed.assert_called_once()
    svc.registration_svc.apply_lottery_results.assert_called_once()
    svc.session.refresh.assert_awaited() # 用 refresh 而非再 get_record
    call_kwargs = svc.registration_svc.apply_lottery_results.call_args.kwargs
    assert len(call_kwargs["winners"]) == 3
    assert len(call_kwargs["waitlist"]) == 2
    assert len(call_kwargs["losers"]) == 0


@pytest.mark.asyncio
async def test_more_candidates_than_quota_x2_caps_waitlist(svc: LotteryService) -> None:
    """10 候選 + quota=3 → 3 winners + 3 waitlist(不超過配額)+ 4 losers"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(return_value=_record(candidate_count=10))
    svc.repo.update_record_counts = AsyncMock()
    svc.session.refresh = AsyncMock()
    candidates = [SimpleNamespace(id=f"01HC{i:022d}") for i in range(10)]
    svc.registration_svc.list_registered_for_lottery = AsyncMock(return_value=candidates)
    svc.registration_svc.apply_lottery_results = AsyncMock()

    await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")
    call_kwargs = svc.registration_svc.apply_lottery_results.call_args.kwargs
    assert len(call_kwargs["winners"]) == 3
    assert len(call_kwargs["waitlist"]) == 3
    assert len(call_kwargs["losers"]) == 4


@pytest.mark.asyncio
async def test_fewer_candidates_than_quota(svc: LotteryService) -> None:
    """2 候選 + quota=5 → 2 winners + 0 waitlist + 0 losers(全中)"""
    svc.event_svc.get_session = AsyncMock(
        return_value=_session_info(quotas=[("01HTT1XXXXXXXXXXXXXXXXXXXX", 5)])
    )
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(return_value=_record())
    svc.repo.update_record_counts = AsyncMock()
    svc.session.refresh = AsyncMock()
    candidates = [SimpleNamespace(id=f"01HC{i:022d}") for i in range(2)]
    svc.registration_svc.list_registered_for_lottery = AsyncMock(return_value=candidates)
    svc.registration_svc.apply_lottery_results = AsyncMock()

    await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")
    call_kwargs = svc.registration_svc.apply_lottery_results.call_args.kwargs
    assert len(call_kwargs["winners"]) == 2
    assert len(call_kwargs["waitlist"]) == 0
    assert len(call_kwargs["losers"]) == 0


@pytest.mark.asyncio
async def test_zero_candidates(svc: LotteryService) -> None:
    """0 候選 → 0/0/0 結果"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(return_value=_record())
    svc.repo.update_record_counts = AsyncMock()
    svc.session.refresh = AsyncMock()
    svc.registration_svc.list_registered_for_lottery = AsyncMock(return_value=[])
    svc.registration_svc.apply_lottery_results = AsyncMock()

    await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")
    call_kwargs = svc.registration_svc.apply_lottery_results.call_args.kwargs
    assert call_kwargs["winners"] == []
    assert call_kwargs["waitlist"] == []
    assert call_kwargs["losers"] == []


@pytest.mark.asyncio
async def test_create_race_falls_back_to_existing(svc: LotteryService) -> None:
    """create_record_or_raise 撞到 race(別 pod 剛建)→ rollback + get_record fallback"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(side_effect=LotteryAlreadyExecutedError("race"))
    svc.repo.get_record = AsyncMock(return_value=_record())

    result = await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")
    assert result.ticket_types[0].newly_executed is False
    svc.session.rollback.assert_awaited() # -A4 fix:race fallback 必 rollback
    svc.registration_svc.apply_lottery_results.assert_not_called()


@pytest.mark.asyncio
async def test_create_race_then_record_disappears_re_raises(svc: LotteryService) -> None:
    """罕見:create raise 後 get_record 又 None → 重 raise"""
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.event_svc.mark_lottery_running = AsyncMock()
    svc.event_svc.mark_lottery_completed = AsyncMock()
    svc.repo.create_record_or_raise = AsyncMock(side_effect=LotteryAlreadyExecutedError("race"))
    svc.repo.get_record = AsyncMock(return_value=None)

    with pytest.raises(LotteryAlreadyExecutedError):
        await svc.execute_lottery("01HSESSXXXXXXXXXXXXXXXXXXX")
