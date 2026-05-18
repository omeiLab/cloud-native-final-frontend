"""admin 模組 archive 工具 — 序列化 + 上傳的純邏輯(設計 04 §8.2)。

 Batch B(A3):從 stub 升級為真實 MinIO/S3 上傳。
範圍只含 events 模組 metadata(events + sessions + ticket_types);registrations
與 tickets 的 archive snapshot 留 (需要對應模組各自加 snapshot 介面)。

把 IO 邏輯抽到 archiver 中(脫離 admin/jobs.py),讓 unit test 可以直接驅動 +
mock event_svc / object_storage,不必碰排程器與 advisory lock。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.config import settings
from app.core.logging import get_logger
from app.core.object_storage import (
    is_archive_storage_configured,
    put_archive_object,
)
from app.core.time import now_utc
from app.modules.event.service import EventServiceProtocol
from app.shared.event_ref import EventDetail

logger = get_logger(__name__).bind(component="archiver")


@dataclass(frozen=True)
class ArchiveResult:
    """archive 一輪的結果(供 caller 寫 audit / metrics)"""

    candidates: list[str]
    uploaded: int = 0
    uris: list[str] = field(default_factory=list)
    dry_run: bool = False


def _archive_year(detail: EventDetail) -> int:
    """挑年份決定 S3 key prefix:cancelled_at > sessions.max(ends_at) > created_at"""
    if detail.cancelled_at is not None:
        return detail.cancelled_at.year
    if detail.sessions:
        return max(s.ends_at for s in detail.sessions).year
    return detail.created_at.year


def _archive_key(detail: EventDetail) -> str:
    """設計 04 §8.2:`s3://cets-archive/events/{year}/{event_id}.jsonl`"""
    return f"events/{_archive_year(detail)}/{detail.id}.jsonl"


def _serialize(detail: EventDetail) -> bytes:
    """JSONL 一行 = event detail(含 sessions + ticket_types)JSON。

     補 registrations / tickets 行時,可以 append 多行到同一檔。
    """
    return (detail.model_dump_json() + "\n").encode("utf-8")


async def archive_old_events(
    event_svc: EventServiceProtocol,
    *,
    older_than: datetime | None = None,
    dry_run: bool | None = None,
) -> ArchiveResult:
    """跑一輪 archive — 拉候選 → snapshot → upload。

    Args:
        event_svc: 透過 Protocol 拉 candidate IDs 與 EventDetail(避免 admin 直讀 event repo)
        older_than: 候選條件「sessions.max(ends_at) <」的時間;
                    預設 NOW() - settings.archive_retention_days(2 年)
        dry_run: True 跳過上傳;預設依 `is_archive_storage_configured()` 決定
                (lab 沒設 archive_s3_* → True)

    Returns:
        ArchiveResult(candidates, uploaded, uris, dry_run)
    """
    if older_than is None:
        older_than = now_utc() - timedelta(days=settings.archive_retention_days)
    if dry_run is None:
        dry_run = not is_archive_storage_configured()

    candidates = await event_svc.list_archive_candidate_ids(older_than)

    if dry_run:
        logger.info(
            "archive_dry_run",
            candidates_count=len(candidates),
            older_than=older_than.isoformat(),
        )
        return ArchiveResult(candidates=candidates, dry_run=True)

    uploaded = 0
    uris: list[str] = []
    for event_id in candidates:
        detail = await event_svc.get_event(event_id)
        if detail is None:
            logger.warning("archive_skip_missing_event", event_id=event_id)
            continue
        key = _archive_key(detail)
        body = _serialize(detail)
        uri = await put_archive_object(key=key, body=body, content_type="application/x-ndjson")
        uris.append(uri)
        uploaded += 1

    logger.info(
        "archive_completed",
        candidates_count=len(candidates),
        uploaded=uploaded,
        older_than=older_than.isoformat(),
    )
    return ArchiveResult(candidates=candidates, uploaded=uploaded, uris=uris)


__all__ = ["ArchiveResult", "archive_old_events"]
