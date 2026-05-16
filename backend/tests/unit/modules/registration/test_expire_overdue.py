"""expire_overdue_won APScheduler 任務 — 設計 06 §8.7"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.registration.service import RegistrationService


def _won_overdue(reg_id: str) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=reg_id,
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        status="WON",
        lottery_rank=1,
        confirmation_deadline=now - timedelta(hours=1),
        confirmed_at=None,
        forfeited_at=None,
        cancelled_at=None,
        waitlist_position=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_expire_overdue_won_processes_each_to_expired(svc: RegistrationService) -> None:
    overdue = [_won_overdue(f"01HEXP{i}XXXXXXXXXXXXXXXXXX") for i in range(3)]
    svc.repo.find_overdue_won = AsyncMock(return_value=overdue)
    # update_status 對每筆 + waitlist promotion 也用 update_status,所以給多次回值
    expired_returns = [SimpleNamespace(**{**o.__dict__, "status": "EXPIRED"}) for o in overdue]
    svc.repo.update_status = AsyncMock(side_effect=expired_returns)

    # 沒候補
    svc.event_svc.get_session = AsyncMock(
        return_value=SimpleNamespace(
            waitlist_close_at=datetime.now(UTC) + timedelta(days=1),
            confirmation_deadline_hours=48,
        )
    )
    svc.repo.find_next_waitlist_for_promotion = AsyncMock(return_value=None)

    count = await svc.expire_overdue_won()
    assert count == 3
    assert svc.repo.update_status.await_count == 3
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_expire_overdue_won_returns_zero_when_none_overdue(svc: RegistrationService) -> None:
    svc.repo.find_overdue_won = AsyncMock(return_value=[])
    count = await svc.expire_overdue_won()
    assert count == 0
    svc.session.commit.assert_not_awaited()
    svc.repo.update_status.assert_not_called()
