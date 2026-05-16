"""Redis async client — 用於快取、JWT denylist、Pub/Sub、rate limit"""

from typing import Any

from redis.asyncio import Redis

from app.core.logging import get_logger

logger = get_logger(__name__)

_redis: Redis | None = None


async def init_redis(url: str) -> None:
    global _redis
    _redis = Redis.from_url(url, decode_responses=True, socket_keepalive=True)
    await _redis.ping() # type: ignore[misc]
    logger.info("redis_initialized", url=_mask_redis(url))


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
    logger.info("redis_closed")


def get_redis() -> Redis:
    if _redis is None:
        raise RuntimeError("Redis not initialized")
    return _redis


async def check_redis_connectivity() -> None:
    if _redis is None:
        raise RuntimeError("Redis not initialized")
    await _redis.ping() # type: ignore[misc]


def _mask_redis(url: str) -> str:
    if "@" in url:
        proto, rest = url.split("://", 1)
        _creds, host = rest.split("@", 1)
        return f"{proto}://***@{host}"
    return url


# JWT denylist(對齊設計 6.4 — Access token 撤銷)


def _denylist_key(jti: str) -> str:
    return f"jwt:denylist:{jti}"


async def add_jwt_to_denylist(jti: str, ttl_seconds: int) -> None:
    """登出時把 access token 的 jti 加進 denylist;TTL = exp - now,最少保底 60s 防 clock skew"""
    if ttl_seconds < 0:
        return
    # clock skew 保底:剛過期的 token 也加入 denylist
    ttl_seconds = max(ttl_seconds, 60)
    redis = get_redis()
    await redis.set(_denylist_key(jti), "1", ex=ttl_seconds)


async def is_jwt_revoked(jti: str) -> bool:
    redis = get_redis()
    result: Any = await redis.exists(_denylist_key(jti))
    return bool(result)
