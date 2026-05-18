"""archiver pure-logic tests — Batch B(A3):

archiver 把 archive 的序列化 / 上傳邏輯抽出 jobs.py,讓我們可以 mock event_svc
與 object_storage 直接驗:
- dry_run path 只回候選,不打 S3
- 真實上傳 path 對每個候選呼叫 put_archive_object 一次
- key 路徑符合設計 04 §8.2 `events/{year}/{event_id}.jsonl`
- year 取捨優先序 cancelled_at > sessions.max(ends_at) > created_at
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.time import now_utc
from app.modules.admin.archiver import archive_old_events
from app.shared.enums import EventStatus, SessionStatus
from app.shared.event_ref import EventDetail, SessionInfo


def _make_session(
    *,
    session_id: str = "01" + "S" * 24,
    event_id: str,
    starts_at: datetime,
    ends_at: datetime,
) -> SessionInfo:
    return SessionInfo(
        id=session_id,
        event_id=event_id,
        title="測試場次",
        venue="A1",
        starts_at=starts_at,
        ends_at=ends_at,
        registration_opens_at=starts_at - timedelta(days=14),
        registration_closes_at=starts_at - timedelta(days=7),
        lottery_at=starts_at - timedelta(days=5),
        waitlist_close_at=starts_at - timedelta(days=2),
        confirmation_deadline_hours=48,
        status=SessionStatus.CLOSED,
        lottery_executed_at=None,
        allowed_sites=[],
        ticket_types=[],
    )


def _make_event(
    *,
    event_id: str,
    cancelled_at: datetime | None = None,
    session_ends: list[datetime] | None = None,
    created_at: datetime | None = None,
) -> EventDetail:
    sessions: list[SessionInfo] = []
    if session_ends:
        for i, ends in enumerate(session_ends):
            sessions.append(
                _make_session(
                    session_id=f"01SESS{event_id[-4:]}{i:020d}"[:26],
                    event_id=event_id,
                    starts_at=ends - timedelta(hours=2),
                    ends_at=ends,
                )
            )
    return EventDetail(
        id=event_id,
        title="舊活動",
        description=None,
        cover_image_url=None,
        status=EventStatus.PUBLISHED,
        allowed_sites=[],
        created_by="01" + "U" * 24,
        created_at=created_at or now_utc() - timedelta(days=1000),
        updated_at=created_at or now_utc() - timedelta(days=1000),
        cancelled_at=cancelled_at,
        sessions=sessions,
    )


@pytest.mark.asyncio
async def test_dry_run_returns_candidates_without_uploading() -> None:
    """dry_run=True 時 list_archive_candidate_ids 仍跑,但 put_archive_object 不打"""
    event_svc = MagicMock()
    event_svc.list_archive_candidate_ids = AsyncMock(return_value=["evt1", "evt2"])
    event_svc.get_event = AsyncMock()

    with patch("app.modules.admin.archiver.put_archive_object", new_callable=AsyncMock) as mock_put:
        result = await archive_old_events(event_svc, dry_run=True)

    assert result.dry_run is True
    assert result.candidates == ["evt1", "evt2"]
    assert result.uploaded == 0
    assert result.uris == []
    mock_put.assert_not_awaited()
    event_svc.get_event.assert_not_awaited()


@pytest.mark.asyncio
async def test_uploads_each_candidate_with_correct_key() -> None:
    """每個候選 → 一次 get_event + 一次 put_archive_object;key 走 cancelled_at.year"""
    cancelled = datetime(2022, 6, 15, tzinfo=now_utc().tzinfo)
    event = _make_event(event_id="01EVT" + "A" * 21, cancelled_at=cancelled)

    event_svc = MagicMock()
    event_svc.list_archive_candidate_ids = AsyncMock(return_value=[event.id])
    event_svc.get_event = AsyncMock(return_value=event)

    with patch(
        "app.modules.admin.archiver.put_archive_object",
        new_callable=AsyncMock,
        return_value=f"s3://cets-archive/events/2022/{event.id}.jsonl",
    ) as mock_put:
        result = await archive_old_events(event_svc, dry_run=False)

    assert result.uploaded == 1
    assert len(result.uris) == 1
    mock_put.assert_awaited_once()
    kwargs = mock_put.await_args.kwargs
    assert kwargs["key"] == f"events/2022/{event.id}.jsonl"
    assert kwargs["content_type"] == "application/x-ndjson"
    # body 是 EventDetail JSON + \n
    body = kwargs["body"]
    assert isinstance(body, bytes)
    assert body.endswith(b"\n")
    assert event.id.encode() in body


@pytest.mark.asyncio
async def test_year_falls_back_to_session_ends_when_not_cancelled() -> None:
    """未取消的 event:year 取 sessions.max(ends_at).year"""
    s1 = datetime(2021, 4, 1, tzinfo=now_utc().tzinfo)
    s2 = datetime(2023, 8, 10, tzinfo=now_utc().tzinfo)
    event = _make_event(event_id="01EVT" + "B" * 21, session_ends=[s1, s2])

    event_svc = MagicMock()
    event_svc.list_archive_candidate_ids = AsyncMock(return_value=[event.id])
    event_svc.get_event = AsyncMock(return_value=event)

    with patch(
        "app.modules.admin.archiver.put_archive_object",
        new_callable=AsyncMock,
        return_value="s3://x/y",
    ) as mock_put:
        await archive_old_events(event_svc, dry_run=False)

    assert mock_put.await_args.kwargs["key"] == f"events/2023/{event.id}.jsonl"


@pytest.mark.asyncio
async def test_skips_missing_event_returned_as_none() -> None:
    """list 給 ID 但 get_event 回 None(賽跑被刪)→ 跳過,不算上傳"""
    event_svc = MagicMock()
    event_svc.list_archive_candidate_ids = AsyncMock(return_value=["ghost1", "ghost2"])
    event_svc.get_event = AsyncMock(return_value=None)

    with patch("app.modules.admin.archiver.put_archive_object", new_callable=AsyncMock) as mock_put:
        result = await archive_old_events(event_svc, dry_run=False)

    assert result.uploaded == 0
    assert result.candidates == ["ghost1", "ghost2"]
    mock_put.assert_not_awaited()
