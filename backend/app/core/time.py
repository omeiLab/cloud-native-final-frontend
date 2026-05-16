"""時區 helper — 全系統用 Asia/Taipei,對齊資料庫設計書 §2.3"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

TAIPEI_TZ = ZoneInfo("Asia/Taipei")


def now_utc() -> datetime:
    """當前 UTC 時間(供存進 TIMESTAMPTZ)"""
    return datetime.now(UTC)


def now_taipei() -> datetime:
    """當前 Asia/Taipei 時間(供顯示)"""
    return datetime.now(TAIPEI_TZ)


def to_taipei(dt: datetime) -> datetime:
    """任意 datetime 轉 Asia/Taipei"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(TAIPEI_TZ)
