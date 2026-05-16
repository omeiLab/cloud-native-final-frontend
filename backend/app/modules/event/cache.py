"""event 模組 Redis 快取層 — 對齊設計 06 §7.7 + §6.4

只快取讀路徑;mutation 主動 evict。
"""

from typing import Any

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.shared.event_ref import EventDetail, SessionInfo

logger = get_logger(__name__)

# 快取 key
_EVENT_DETAIL_KEY = "event:detail:{event_id}"
_SESSION_KEY = "session:{session_id}"
_LIST_KEY_PATTERN = "events:list:{site}:*" # SCAN 用

# TTL(秒)
_EVENT_DETAIL_TTL = 60
_SESSION_TTL = 60


async def get_event_detail(event_id: str) -> EventDetail | None:
    raw = await _get_raw(_EVENT_DETAIL_KEY.format(event_id=event_id))
    if raw is None:
        return None
    try:
        return EventDetail.model_validate_json(raw)
    except Exception: # pragma: no cover
        logger.warning("event_cache_parse_failed", event_id=event_id)
        return None


async def set_event_detail(event_id: str, detail: EventDetail) -> None:
    redis = get_redis()
    await redis.set(
        _EVENT_DETAIL_KEY.format(event_id=event_id),
        detail.model_dump_json(),
        ex=_EVENT_DETAIL_TTL,
    )


async def get_session(session_id: str) -> SessionInfo | None:
    raw = await _get_raw(_SESSION_KEY.format(session_id=session_id))
    if raw is None:
        return None
    try:
        return SessionInfo.model_validate_json(raw)
    except Exception: # pragma: no cover
        return None


async def set_session(session_id: str, info: SessionInfo) -> None:
    redis = get_redis()
    await redis.set(
        _SESSION_KEY.format(session_id=session_id),
        info.model_dump_json(),
        ex=_SESSION_TTL,
    )


async def evict_event(event_id: str) -> None:
    """Mutation 後清快取(event detail + 該 event 所有 session)"""
    redis = get_redis()
    keys: list[str] = [_EVENT_DETAIL_KEY.format(event_id=event_id)]
    # 列表類:SCAN 全清
    : int = 0
    while True:
        , found = await redis.scan(=, match="events:list:*", count=100)
        keys.extend(found)
        if == 0:
            break
    if keys:
        await redis.delete(*keys)


async def evict_session(session_id: str) -> None:
    redis = get_redis()
    await redis.delete(_SESSION_KEY.format(session_id=session_id))


async def _get_raw(key: str) -> str | None:
    redis = get_redis()
    val: Any = await redis.get(key)
    if val is None:
        return None
    if isinstance(val, bytes):
        return val.decode("utf-8")
    return str(val)
