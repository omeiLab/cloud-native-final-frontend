"""update_session API:cache eviction + status 守衛 + audit。

對應 production bug #3:DB UPDATE sessions.starts_at 後 Redis cache(60s TTL)
仍為舊值,造成核銷時段判斷錯誤。修法為提供 PATCH /admin/sessions/{id} API,
寫入後同時 evict session + event cache。
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.event.errors import InvalidEventStateError, SessionNotFoundError
from app.modules.event.service import EventService


def _session(status: str = "REGISTRATION_OPEN") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id="01H88888888888888888888888",
        event_id="01HEVTXXXXXXXXXXXXXXXXXXXX",
        title="上午場",
        venue="A1",
        starts_at=now + timedelta(days=14),
        ends_at=now + timedelta(days=14, hours=3),
        registration_opens_at=now - timedelta(days=1),
        registration_closes_at=now + timedelta(days=7),
        lottery_at=now + timedelta(days=8),
        waitlist_close_at=now + timedelta(days=13),
        confirmation_deadline_hours=48,
        status=status,
        lottery_executed_at=None,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> EventService:
    async def _noop_audit(*a: object, **k: object) -> None:
        return None

    from app.modules.event import service as svc_mod

    monkeypatch.setattr(svc_mod, "audit", _noop_audit)

    s = EventService.__new__(EventService)
    s.session = AsyncMock()
    s.session_repo = AsyncMock()
    s.event_repo = AsyncMock()
    s.ticket_type_repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_update_session_evicts_session_and_event_cache(
    svc: EventService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """寫入後必須 evict session 與 event 兩層 cache,避免驗票讀到舊 starts_at"""
    from app.modules.event import cache as cache_mod

    evict_session_mock = AsyncMock()
    evict_event_mock = AsyncMock()
    monkeypatch.setattr(cache_mod, "evict_session", evict_session_mock)
    monkeypatch.setattr(cache_mod, "evict_event", evict_event_mock)

    sess = _session()
    svc.session_repo.get_by_id = AsyncMock(return_value=sess)
    svc.session_repo.update_fields = AsyncMock(return_value=sess)
    svc.session_repo.list_by_event = AsyncMock(return_value=[])
    svc.ticket_type_repo.list_by_session = AsyncMock(return_value=[])

    new_starts = datetime.now(UTC) + timedelta(days=10)
    await svc.update_session(
        session_id=sess.id,
        actor_id="admin1",
        actor_role="ADMIN",
        fields={"starts_at": new_starts},
    )

    evict_session_mock.assert_awaited_once_with(sess.id)
    evict_event_mock.assert_awaited_once_with(sess.event_id)


@pytest.mark.asyncio
async def test_update_session_status_close_only_from_open(
    svc: EventService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """status 改為 REGISTRATION_CLOSED,只允許從 REGISTRATION_OPEN 轉;
    其他狀態應回 InvalidEventStateError(避免覆蓋 lottery-runner 已標記的 LOTTERY_RUNNING)
    """
    from app.modules.event import cache as cache_mod

    monkeypatch.setattr(cache_mod, "evict_session", AsyncMock())
    monkeypatch.setattr(cache_mod, "evict_event", AsyncMock())

    sess = _session(status="LOTTERY_COMPLETED")
    svc.session_repo.get_by_id = AsyncMock(return_value=sess)

    with pytest.raises(InvalidEventStateError):
        await svc.update_session(
            session_id=sess.id,
            actor_id="admin1",
            actor_role="ADMIN",
            fields={"status": "REGISTRATION_CLOSED"},
        )

    svc.session_repo.update_fields.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_session_status_toctou_race_raises(
    svc: EventService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex audit fix:read-after-modify race — service 讀到 REGISTRATION_OPEN
    但 repo UPDATE 帶 expected_status='REGISTRATION_OPEN' 守衛時影響 0 列
    (同時 lottery-runner 已寫 LOTTERY_RUNNING),須 raise InvalidEventStateError
    而非靜默成功"""
    from app.modules.event import cache as cache_mod

    monkeypatch.setattr(cache_mod, "evict_session", AsyncMock())
    monkeypatch.setattr(cache_mod, "evict_event", AsyncMock())

    sess = _session(status="REGISTRATION_OPEN")
    svc.session_repo.get_by_id = AsyncMock(return_value=sess)
    # UPDATE 影響 0 列(lottery-runner 已搶先寫)
    svc.session_repo.update_fields = AsyncMock(return_value=None)

    with pytest.raises(InvalidEventStateError, match="lottery-runner"):
        await svc.update_session(
            session_id=sess.id,
            actor_id="admin1",
            actor_role="ADMIN",
            fields={"status": "REGISTRATION_CLOSED"},
        )
    # update_fields 必須帶 expected_status 守衛
    svc.session_repo.update_fields.assert_awaited_once()
    kwargs = svc.session_repo.update_fields.await_args.kwargs
    assert kwargs.get("expected_status") == "REGISTRATION_OPEN"


@pytest.mark.asyncio
async def test_update_session_time_only_no_expected_status(
    svc: EventService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """純改時間欄位(無 status)→ 不傳 expected_status,不上 CAS 鎖;
    時間順序仍由 chk_sessions_time_order DB CHECK 把關"""
    from app.modules.event import cache as cache_mod

    monkeypatch.setattr(cache_mod, "evict_session", AsyncMock())
    monkeypatch.setattr(cache_mod, "evict_event", AsyncMock())

    sess = _session(status="REGISTRATION_OPEN")
    svc.session_repo.get_by_id = AsyncMock(return_value=sess)
    svc.session_repo.update_fields = AsyncMock(return_value=sess)
    svc.session_repo.list_by_event = AsyncMock(return_value=[])
    svc.ticket_type_repo.list_by_session = AsyncMock(return_value=[])

    await svc.update_session(
        session_id=sess.id,
        actor_id="admin1",
        actor_role="ADMIN",
        fields={"venue": "新場地"},
    )
    kwargs = svc.session_repo.update_fields.await_args.kwargs
    assert kwargs.get("expected_status") is None


@pytest.mark.asyncio
async def test_update_session_not_found_raises(
    svc: EventService, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.event import cache as cache_mod

    monkeypatch.setattr(cache_mod, "evict_session", AsyncMock())
    monkeypatch.setattr(cache_mod, "evict_event", AsyncMock())

    svc.session_repo.get_by_id = AsyncMock(return_value=None)

    with pytest.raises(SessionNotFoundError):
        await svc.update_session(
            session_id="01HMISSINGSESSIONXXXXXXXXX",
            actor_id="admin1",
            actor_role="ADMIN",
            fields={"venue": "B2"},
        )
