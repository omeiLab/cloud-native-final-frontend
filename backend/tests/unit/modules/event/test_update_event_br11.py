"""BR-11:活動發布後 allowed_sites 不可修改"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.event.errors import CannotModifyPublishedFieldError
from app.modules.event.service import EventService


def _make_event(status: str, allowed_sites: list[str]) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id="01H8YYYYYYYYYYYYYYYYYYYYYY",
        title="家庭日",
        description="說明",
        cover_image_url=None,
        status=status,
        allowed_sites=allowed_sites,
        created_by="01HCREATORXXXXXXXXXXXXXXXX",
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
async def test_published_event_blocks_allowed_sites_change(svc: EventService) -> None:
    """PUBLISHED 狀態下,fields 含 allowed_sites → 直接擋"""
    svc.event_repo.get_by_id = AsyncMock(return_value=_make_event("PUBLISHED", ["HSINCHU"]))

    with pytest.raises(CannotModifyPublishedFieldError):
        await svc.update_event(
            event_id="01H8YYYYYYYYYYYYYYYYYYYYYY",
            actor_id="01HADMINXXXXXXXXXXXXXXXXXX",
            actor_role="ADMIN",
            fields={"allowed_sites": ["TAINAN"]},
        )


@pytest.mark.asyncio
async def test_draft_event_allows_allowed_sites_change(svc: EventService) -> None:
    """DRAFT 狀態下,allowed_sites 可改;不該丟 CannotModifyPublishedFieldError"""
    event = _make_event("DRAFT", ["HSINCHU"])
    svc.event_repo.get_by_id = AsyncMock(return_value=event)
    # update_fields 與 cache evict 都 mock(本測試只關心 BR-11 守衛)
    updated = _make_event("DRAFT", ["TAINAN"])
    svc.event_repo.update_fields = AsyncMock(return_value=updated)
    svc.session_repo.list_by_event = AsyncMock(return_value=[])

    # patch cache + audit 不做事
    import app.modules.event.cache as event_cache
    import app.modules.event.service as service_mod

    async def _noop(*a: object, **k: object) -> None:
        return None

    service_mod.audit = _noop # type: ignore[assignment]
    event_cache.evict_event = _noop # type: ignore[assignment]

    result = await svc.update_event(
        event_id=event.id,
        actor_id="01HADMINXXXXXXXXXXXXXXXXXX",
        actor_role="ADMIN",
        fields={"allowed_sites": ["TAINAN"]},
    )
    assert result.allowed_sites == ["TAINAN"]


@pytest.mark.asyncio
async def test_published_event_allows_title_change(svc: EventService) -> None:
    """PUBLISHED 但 fields 不含 allowed_sites → 應正常更新"""
    event = _make_event("PUBLISHED", ["HSINCHU"])
    svc.event_repo.get_by_id = AsyncMock(return_value=event)
    updated = _make_event("PUBLISHED", ["HSINCHU"])
    updated.title = "改名後"
    svc.event_repo.update_fields = AsyncMock(return_value=updated)
    svc.session_repo.list_by_event = AsyncMock(return_value=[])

    import app.modules.event.cache as event_cache
    import app.modules.event.service as service_mod

    async def _noop(*a: object, **k: object) -> None:
        return None

    service_mod.audit = _noop # type: ignore[assignment]
    event_cache.evict_event = _noop # type: ignore[assignment]

    result = await svc.update_event(
        event_id=event.id,
        actor_id="01HADMINXXXXXXXXXXXXXXXXXX",
        actor_role="ADMIN",
        fields={"title": "改名後"},
    )
    assert result.title == "改名後"
