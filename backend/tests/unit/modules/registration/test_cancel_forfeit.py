"""cancel / forfeit 狀態守衛 + 越權阻擋 + waitlist 遞補觸發"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.registration.errors import (
    CannotCancelError,
    CannotForfeitError,
    RegistrationNotFoundError,
)
from app.modules.registration.service import RegistrationService


def _reg(*, status: str, user_id: str = "01HUSERXXXXXXXXXXXXXXXXXXX") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id="01HRGXXXXXXXXXXXXXXXXXXXXX",
        user_id=user_id,
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
async def test_cancel_only_allows_registered(svc: RegistrationService) -> None:
    svc.repo.get_by_id_for_update = AsyncMock(return_value=_reg(status="WON"))
    with pytest.raises(CannotCancelError):
        await svc.cancel(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_cancel_succeeds_for_registered(svc: RegistrationService) -> None:
    reg = _reg(status="REGISTERED")
    svc.repo.get_by_id_for_update = AsyncMock(return_value=reg)
    cancelled = SimpleNamespace(**{**reg.__dict__, "status": "CANCELLED"})
    svc.repo.update_status = AsyncMock(return_value=cancelled)
    result = await svc.cancel(
        registration_id=reg.id,
        user_id=reg.user_id,
        user_role="EMPLOYEE",
    )
    assert result.status == "CANCELLED"


@pytest.mark.asyncio
async def test_cancel_other_users_registration_returns_notfound(svc: RegistrationService) -> None:
    svc.repo.get_by_id_for_update = AsyncMock(
        return_value=_reg(status="REGISTERED", user_id="OTHER")
    )
    with pytest.raises(RegistrationNotFoundError):
        await svc.cancel(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_forfeit_only_allows_won(svc: RegistrationService) -> None:
    svc.repo.get_by_id_for_update = AsyncMock(return_value=_reg(status="REGISTERED"))
    with pytest.raises(CannotForfeitError):
        await svc.forfeit(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_forfeit_triggers_waitlist_promotion(svc: RegistrationService) -> None:
    """棄權後候補遞補觸發 — 假設場次仍在 waitlist_close_at 之前"""
    won_reg = _reg(status="WON")
    svc.repo.get_by_id_for_update = AsyncMock(return_value=won_reg)
    forfeited = SimpleNamespace(**{**won_reg.__dict__, "status": "FORFEITED"})
    svc.repo.update_status = AsyncMock(side_effect=[forfeited, _reg(status="WON")])

    # event_svc.get_session 回未截止場次
    future_close = datetime.now(UTC) + timedelta(days=1)
    svc.event_svc.get_session = AsyncMock(
        return_value=SimpleNamespace(
            waitlist_close_at=future_close,
            confirmation_deadline_hours=48,
        )
    )
    waitlist_candidate = _reg(status="WAITLISTED")
    waitlist_candidate.id = "01HCANDIDATEXXXXXXXXXXXXX1"
    svc.repo.find_next_waitlist_for_promotion = AsyncMock(return_value=waitlist_candidate)

    result = await svc.forfeit(
        registration_id=won_reg.id,
        user_id=won_reg.user_id,
        user_role="EMPLOYEE",
    )
    assert result.status == "FORFEITED"
    svc.repo.find_next_waitlist_for_promotion.assert_awaited_once_with(
        won_reg.session_id, won_reg.ticket_type_id
    )


@pytest.mark.asyncio
async def test_promotion_skipped_after_waitlist_close(svc: RegistrationService) -> None:
    """場次已過 waitlist_close_at 不再遞補(設計 06 §8.6)"""
    won_reg = _reg(status="WON")
    svc.repo.get_by_id_for_update = AsyncMock(return_value=won_reg)
    forfeited = SimpleNamespace(**{**won_reg.__dict__, "status": "FORFEITED"})
    svc.repo.update_status = AsyncMock(return_value=forfeited)
    svc.event_svc.get_session = AsyncMock(
        return_value=SimpleNamespace(
            waitlist_close_at=datetime.now(UTC) - timedelta(hours=1),
            confirmation_deadline_hours=48,
        )
    )
    svc.repo.find_next_waitlist_for_promotion = AsyncMock()

    await svc.forfeit(
        registration_id=won_reg.id,
        user_id=won_reg.user_id,
        user_role="EMPLOYEE",
    )
    svc.repo.find_next_waitlist_for_promotion.assert_not_awaited()


@pytest.mark.asyncio
async def test_forfeit_publishes_waitlist_promoted_event(
    svc: RegistrationService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ 全修:棄權後遞補必須 publish WaitlistPromoted 給 notification 模組。

    違反此契約 → 候補遞補者收不到 WAITLIST_PROMOTED 通知,違反 FR-NOTIF-06。
    expire_overdue_won 路徑已 publish,forfeit 路徑漏掉是 漂移。
    """
    from app.core import events as events_mod

    captured: list[object] = []

    async def _spy_publish(event: object) -> None:
        captured.append(event)

    monkeypatch.setattr(events_mod.event_bus, "publish", _spy_publish)

    won_reg = _reg(status="WON")
    svc.repo.get_by_id_for_update = AsyncMock(return_value=won_reg)
    forfeited = SimpleNamespace(**{**won_reg.__dict__, "status": "FORFEITED"})

    promoted_full = _reg(status="WON")
    promoted_full.id = "01HCANDIDATEXXXXXXXXXXXXX1"
    promoted_full.user_id = "01HCANDUSERXXXXXXXXXXXXXX1"
    promoted_full.confirmation_deadline = datetime.now(UTC) + timedelta(hours=48)
    svc.repo.update_status = AsyncMock(side_effect=[forfeited, promoted_full])
    svc.event_svc.get_session = AsyncMock(
        return_value=SimpleNamespace(
            waitlist_close_at=datetime.now(UTC) + timedelta(days=1),
            confirmation_deadline_hours=48,
        )
    )
    candidate = _reg(status="WAITLISTED")
    candidate.id = promoted_full.id
    svc.repo.find_next_waitlist_for_promotion = AsyncMock(return_value=candidate)
    svc.repo.get_by_id = AsyncMock(return_value=promoted_full)

    await svc.forfeit(
        registration_id=won_reg.id,
        user_id=won_reg.user_id,
        user_role="EMPLOYEE",
    )

    promoted_events = [e for e in captured if e.__class__.__name__ == "WaitlistPromoted"]
    assert len(promoted_events) == 1, f"expected 1 WaitlistPromoted, got {captured}"
    assert promoted_events[0].registration_id == promoted_full.id
    assert promoted_events[0].user_id == promoted_full.user_id
