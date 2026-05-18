"""replay_for_audit 三條 branch:no record / set mismatch / order mismatch / pass"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.lottery.errors import (
    LotteryRecordNotFoundError,
    LotteryReplayMismatchError,
)
from app.modules.lottery.service import LotteryService, _fisher_yates_shuffle


def _record(seed: str, winner_count: int = 3) -> SimpleNamespace:
    return SimpleNamespace(
        id="01HRECXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSESSXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTT1XXXXXXXXXXXXXXXXXXXX",
        seed=seed,
        candidate_count=5,
        winner_count=winner_count,
        waitlist_count=2,
        algorithm_version="fisher-yates-v1",
        executed_at=datetime.now(UTC),
        duration_ms=42,
    )


def _ref(reg_id: str, rank: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=reg_id,
        user_id="u",
        session_id="s",
        ticket_type_id="t",
        status="WON",
        lottery_rank=rank,
        waitlist_position=None,
    )


@pytest.mark.asyncio
async def test_replay_raises_when_no_record(svc: LotteryService) -> None:
    """設計 §9.7 + R3 fix:找不到原紀錄拋 LotteryRecordNotFoundError(BusinessError),非 ValueError"""
    svc.repo.get_record = AsyncMock(return_value=None)
    with pytest.raises(LotteryRecordNotFoundError):
        await svc.replay_for_audit("s", "t")


@pytest.mark.asyncio
async def test_replay_passes_when_winners_match(svc: LotteryService) -> None:
    """正常情境:重跑 winners 與現存集合 + 順序皆一致"""
    seed = "deadbeef" * 8
    candidate_ids = [f"01HC{i:022d}" for i in range(5)]
    shuffled = _fisher_yates_shuffle(candidate_ids, seed)
    expected_winners = shuffled[:3]

    svc.repo.get_record = AsyncMock(return_value=_record(seed, winner_count=3))
    svc.registration_svc.list_registered_for_lottery = AsyncMock(
        return_value=[SimpleNamespace(id=cid) for cid in candidate_ids]
    )
    svc.registration_svc.list_winners_for_audit = AsyncMock(
        return_value=[_ref(wid, rank=i + 1) for i, wid in enumerate(expected_winners)]
    )

    result = await svc.replay_for_audit("s", "t")
    assert result.matches is True
    assert result.original_winners == expected_winners
    assert result.replayed_winners == expected_winners


@pytest.mark.asyncio
async def test_replay_set_mismatch_raises(svc: LotteryService) -> None:
    """集合不同 = 換人中 → raise"""
    seed = "deadbeef" * 8
    candidate_ids = [f"01HC{i:022d}" for i in range(5)]
    shuffled = _fisher_yates_shuffle(candidate_ids, seed)

    svc.repo.get_record = AsyncMock(return_value=_record(seed, winner_count=3))
    svc.registration_svc.list_registered_for_lottery = AsyncMock(
        return_value=[SimpleNamespace(id=cid) for cid in candidate_ids]
    )
    # 故意把 winners 改成「跟原 shuffle[:3] 不同」(取後三個)
    tampered = shuffled[2:5] # 不一定有重疊
    svc.registration_svc.list_winners_for_audit = AsyncMock(
        return_value=[_ref(wid, rank=i + 1) for i, wid in enumerate(tampered)]
    )

    if set(tampered) != set(shuffled[:3]):
        with pytest.raises(LotteryReplayMismatchError, match="集合不同"):
            await svc.replay_for_audit("s", "t")


@pytest.mark.asyncio
async def test_replay_order_mismatch_raises(svc: LotteryService) -> None:
    """集合相同但順序不同 = 改 rank → raise"""
    seed = "deadbeef" * 8
    candidate_ids = [f"01HC{i:022d}" for i in range(5)]
    shuffled = _fisher_yates_shuffle(candidate_ids, seed)
    expected = shuffled[:3]
    # 同集合不同順序(reverse)
    swapped = list(reversed(expected))

    svc.repo.get_record = AsyncMock(return_value=_record(seed, winner_count=3))
    svc.registration_svc.list_registered_for_lottery = AsyncMock(
        return_value=[SimpleNamespace(id=cid) for cid in candidate_ids]
    )
    svc.registration_svc.list_winners_for_audit = AsyncMock(
        return_value=[_ref(wid, rank=i + 1) for i, wid in enumerate(swapped)]
    )

    with pytest.raises(LotteryReplayMismatchError, match="順序不同"):
        await svc.replay_for_audit("s", "t")
