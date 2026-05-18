"""admin export 任務狀態 — Redis-backed task queue + state(Batch B A6)。

設計考量(避免引入 RQ / Dramatiq 等 task queue framework):
- 任務狀態存在 Redis hash `export:job:{task_id}` 中,TTL 1 day
- 任務 ID 存在 Redis list `export:queue` 中(rpush 入隊,lpop 出隊)
- worker(`export_worker.py`)由 main-api 內 APScheduler 每 30s 跑一次
- 結果物件存在 archive S3/MinIO 同 bucket(prefix `exports/`),
  download endpoint 走 main-api 代理(StreamingResponse) — 改 presigned URL
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Literal

from app.core.time import now_utc
from app.core.ulid import generate_ulid

if TYPE_CHECKING:
    from redis.asyncio import Redis

ExportStatus = Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]
ExportFormat = Literal["csv", "xlsx"]

EXPORT_TTL_SEC = 86400 # 1 day
QUEUE_KEY = "export:queue"


def _task_key(task_id: str) -> str:
    return f"export:job:{task_id}"


async def enqueue(
    redis: Redis,
    *,
    event_id: str,
    fmt: ExportFormat,
    mask_pii: bool,
    actor_id: str,
) -> str:
    """建任務 + 推進 queue,回 task_id。actor_id 給 audit 用。"""
    task_id = generate_ulid()
    now_iso = now_utc().isoformat()
    await redis.hset(# type: ignore[misc]
        _task_key(task_id),
        mapping={
            "task_id": task_id,
            "event_id": event_id,
            "format": fmt,
            "mask_pii": "1" if mask_pii else "0",
            "actor_id": actor_id,
            "status": "PENDING",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    )
    await redis.expire(_task_key(task_id), EXPORT_TTL_SEC)
    await redis.rpush(QUEUE_KEY, task_id) # type: ignore[misc]
    return task_id


async def get_state(redis: Redis, task_id: str) -> dict[str, str] | None:
    """讀任務狀態;不存在(過期或亂打 ID)→ None"""
    data: dict[str, str] = await redis.hgetall(_task_key(task_id)) # type: ignore[misc]
    return data or None


async def mark_running(redis: Redis, task_id: str) -> None:
    await _update(redis, task_id, status="RUNNING", started_at=now_utc().isoformat())


async def mark_succeeded(redis: Redis, task_id: str, *, object_key: str) -> None:
    """成功:寫 object_key(S3 path);download endpoint 之後拉這個讀回 stream"""
    await _update(
        redis,
        task_id,
        status="SUCCEEDED",
        finished_at=now_utc().isoformat(),
        object_key=object_key,
    )


async def mark_failed(redis: Redis, task_id: str, *, error: str) -> None:
    await _update(
        redis,
        task_id,
        status="FAILED",
        finished_at=now_utc().isoformat(),
        error=error[:500], # 截斷防 hash 暴漲
    )


async def pop_pending(redis: Redis) -> str | None:
    """從 queue 取一個 task_id;沒則回 None。"""
    result: str | None = await redis.lpop(QUEUE_KEY) # type: ignore[misc]
    return result


async def _update(redis: Redis, task_id: str, **fields: str) -> None:
    if not fields:
        return
    fields["updated_at"] = now_utc().isoformat()
    await redis.hset(_task_key(task_id), mapping=fields) # type: ignore[misc]


def parse_created_at(state: dict[str, str]) -> datetime | None:
    raw = state.get("created_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


__all__ = [
    "EXPORT_TTL_SEC",
    "QUEUE_KEY",
    "ExportFormat",
    "ExportStatus",
    "enqueue",
    "get_state",
    "mark_failed",
    "mark_running",
    "mark_succeeded",
    "parse_created_at",
    "pop_pending",
]
