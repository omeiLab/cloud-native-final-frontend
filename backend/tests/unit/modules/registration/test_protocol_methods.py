"""跨模組 Protocol 方法 — get_registration / list_by_session / count_by_status_per_session /
list_registered_for_lottery / lock_for_confirmation / apply_lottery_results"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.registration.service import RegistrationService


def _reg(reg_id: str, status: str) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=reg_id,
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        status=status,
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
async def test_get_registration_returns_none_when_missing(svc: RegistrationService) -> None:
    svc.repo.get_by_id = AsyncMock(return_value=None)
    assert await svc.get_registration("missing-id") is None


@pytest.mark.asyncio
async def test_get_registration_maps_to_detail(svc: RegistrationService) -> None:
    svc.repo.get_by_id = AsyncMock(return_value=_reg("01HRGXXXXXXXXXXXXXXXXXXXXX", "WON"))
    result = await svc.get_registration("01HRGXXXXXXXXXXXXXXXXXXXXX")
    assert result is not None
    assert result.status == "WON"


@pytest.mark.asyncio
async def test_list_registered_for_lottery_filters_to_registered_only(
    svc: RegistrationService,
) -> None:
    svc.repo.list_by_session_ticket_type = AsyncMock(
        return_value=[_reg("01HR1XXXXXXXXXXXXXXXXXXXXX", "REGISTERED")]
    )
    refs = await svc.list_registered_for_lottery("sess", "tt")
    assert len(refs) == 1
    svc.repo.list_by_session_ticket_type.assert_awaited_once_with(
        "sess", "tt", status_in=["REGISTERED"]
    )


@pytest.mark.asyncio
async def test_list_by_session_with_status_filter(svc: RegistrationService) -> None:
    svc.repo.list_by_session = AsyncMock(return_value=[_reg("01HR1XXXXXXXXXXXXXXXXXXXXX", "WON")])
    result = await svc.list_by_session("sess", status="WON")
    assert len(result) == 1
    svc.repo.list_by_session.assert_awaited_once_with("sess", status="WON")


@pytest.mark.asyncio
async def test_count_by_status_per_session_empty_returns_empty(
    svc: RegistrationService,
) -> None:
    result = await svc.count_by_status_per_session([])
    assert result == {}


@pytest.mark.asyncio
async def test_count_by_status_per_session_passes_through(
    svc: RegistrationService,
) -> None:
    svc.repo.count_by_session_ids_grouped = AsyncMock(
        return_value={"s1": {"WON": 5, "WAITLISTED": 3}, "s2": {}}
    )
    result = await svc.count_by_status_per_session(["s1", "s2"])
    assert result["s1"]["WON"] == 5
    assert result["s2"] == {}


@pytest.mark.asyncio
async def test_apply_lottery_results_delegates_to_repo(svc: RegistrationService) -> None:
    """caller 自負 transaction commit;repo 收到正確的批次資料"""
    svc.repo.bulk_apply_lottery = AsyncMock()
    deadline = datetime.now(UTC) + timedelta(hours=48)
    await svc.apply_lottery_results(
        session_id="sess",
        ticket_type_id="tt",
        winners=[("r1", 1), ("r2", 2)],
        waitlist=[("r3", 3, 1), ("r4", 4, 2)],
        losers=["r5", "r6"],
        confirmation_deadline=deadline,
    )
    svc.repo.bulk_apply_lottery.assert_awaited_once_with(
        winners=[("r1", 1), ("r2", 2)],
        waitlist=[("r3", 3, 1), ("r4", 4, 2)],
        losers=["r5", "r6"],
        confirmation_deadline=deadline,
    )
    svc.session.commit.assert_not_awaited() # caller 自負


def test_bulk_apply_lottery_sql_has_registered_guard() -> None:
    """Codex audit fix:三條 UPDATE 都需帶 r.status = 'REGISTERED' 守衛
    防 race(user cancel commit 後 lottery 不可覆蓋 CANCELLED)。

    純字串檢測,避免回退到沒守衛版本。
    """
    import inspect

    from app.modules.registration import repository as repo_mod

    src = inspect.getsource(repo_mod.RegistrationRepository.bulk_apply_lottery)
    # winners + waitlist 用 raw SQL CAS;losers 用 SQLAlchemy update().where()
    assert "WHERE r.id = v.id AND r.status = 'REGISTERED'" in src, (
        "winners / waitlist 兩條 raw SQL 都需要 r.status = 'REGISTERED' 守衛"
    )
    assert 'Registration.status == "REGISTERED"' in src, (
        "losers ORM update 需.where(Registration.status == 'REGISTERED')"
    )


@pytest.mark.asyncio
async def test_lock_for_confirmation_uses_passed_session(
    svc: RegistrationService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lock_for_confirmation 用 caller 傳入的 session(ticket 模組)而非 self.session"""
    from app.modules.registration import service as svc_mod

    caller_session = AsyncMock()
    captured: list[object] = []

    class _FakeRepo:
        def __init__(self, session: object) -> None:
            captured.append(session)

        async def get_by_id_for_update(self, _: str) -> SimpleNamespace:
            return _reg("01HRG", "WON")

    monkeypatch.setattr(svc_mod, "RegistrationRepository", _FakeRepo)

    result = await svc.lock_for_confirmation("01HRG", caller_session)
    assert result.status == "WON"
    assert captured == [caller_session] # 用了傳入的 session,沒用 svc.session
    svc.session.execute.assert_not_called() # 確認沒用 self.session


@pytest.mark.asyncio
async def test_lock_for_confirmation_raises_when_missing(
    svc: RegistrationService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """spec 要求 non-Optional 回傳;找不到應 raise NotFound"""
    from app.modules.registration import service as svc_mod
    from app.modules.registration.errors import RegistrationNotFoundError

    class _FakeRepo:
        def __init__(self, session: object) -> None:
            pass

        async def get_by_id_for_update(self, _: str) -> None:
            return None

    monkeypatch.setattr(svc_mod, "RegistrationRepository", _FakeRepo)

    with pytest.raises(RegistrationNotFoundError):
        await svc.lock_for_confirmation("01HRG", AsyncMock())


@pytest.mark.asyncio
async def test_list_lottery_outcome_user_ids_separates_won_waitlist_lost(
    svc: RegistrationService,
) -> None:
    """ 全修:正確把 WON / WAITLISTED / LOST 三類分開。

    違反此契約 → lottery 通知會把 WAITLISTED 員工當 LOST 通知,違反 FR-NOTIF-06。
    WON 排序 by lottery_rank ASC;WAITLISTED 排序 by waitlist_position ASC。
    """
    won_a = _reg("rW1", "WON")
    won_a.user_id = "uW1"
    won_a.lottery_rank = 2
    won_b = _reg("rW2", "WON")
    won_b.user_id = "uW2"
    won_b.lottery_rank = 1
    waitlist_a = _reg("rL1", "WAITLISTED")
    waitlist_a.user_id = "uA1"
    waitlist_a.waitlist_position = 2
    waitlist_b = _reg("rL2", "WAITLISTED")
    waitlist_b.user_id = "uA2"
    waitlist_b.waitlist_position = 1
    loser = _reg("rX1", "LOST")
    loser.user_id = "uX1"

    async def _list(session_id: str, ticket_type_id: str, *, status_in: list[str]) -> list:
        if status_in == ["WON"]:
            return [won_a, won_b]
        if status_in == ["WAITLISTED"]:
            return [waitlist_a, waitlist_b]
        if status_in == ["LOST"]:
            return [loser]
        return []

    svc.repo.list_by_session_ticket_type = AsyncMock(side_effect=_list)

    winners, waitlists, losers = await svc.list_lottery_outcome_user_ids("s1", "tt1")

    # WON 依 lottery_rank ASC:uW2(rank=1) → uW1(rank=2)
    assert winners == ["uW2", "uW1"]
    # WAITLISTED 依 waitlist_position ASC:uA2(pos=1) → uA1(pos=2)
    assert waitlists == ["uA2", "uA1"]
    assert losers == ["uX1"]


@pytest.mark.asyncio
async def test_list_lottery_outcome_user_ids_empty_when_no_results(
    svc: RegistrationService,
) -> None:
    svc.repo.list_by_session_ticket_type = AsyncMock(return_value=[])
    winners, waitlists, losers = await svc.list_lottery_outcome_user_ids("s1", "tt1")
    assert winners == [] and waitlists == [] and losers == []
