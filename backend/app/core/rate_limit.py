"""Redis 固定窗 rate limit(加 verify 端點防暴力 / DOS)

最簡實作:`INCR + EXPIRE` per (key, window_seconds)。第一次 INCR 後設 TTL,
之後同 key INCR 累加;超過 limit 即拋 RateLimitedError。可重用於其他端點。

選 fixed-window 而非 sliding/token bucket 是因 lab 階段流量低、多 pod 共用 Redis,
原子 INCR 已足夠;若 admin 端點需要更精細,再升級為 sliding window。
"""

from app.core.exceptions import RateLimitedError
from app.core.redis import get_redis


async def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
) -> None:
    """超過 limit 時拋 RateLimitedError。key 全域唯一(caller 自帶前綴)"""
    redis = get_redis()
    full_key = f"ratelimit:{key}"
    # INCR + EXPIRE NX:第一次累加才設 TTL,避免每次刷新窗口
    count = int(await redis.incr(full_key))
    if count == 1:
        await redis.expire(full_key, window_seconds)
    if count > limit:
        raise RateLimitedError(
            f"請求過於頻繁,請稍後再試(限制 {limit}/{window_seconds}s)",
            details={"limit": limit, "window_seconds": window_seconds},
        )
