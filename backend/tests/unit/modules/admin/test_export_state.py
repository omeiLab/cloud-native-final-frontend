"""export_state Redis CRUD 契約測試 — Batch B(A6)"""

from unittest.mock import AsyncMock

import pytest

from app.modules.admin.export_state import (
    EXPORT_TTL_SEC,
    QUEUE_KEY,
    enqueue,
    get_state,
    mark_failed,
    mark_running,
    mark_succeeded,
    pop_pending,
)


@pytest.mark.asyncio
async def test_enqueue_creates_hash_pushes_to_queue_and_sets_ttl() -> None:
    redis = AsyncMock()
    task_id = await enqueue(
        redis,
        event_id="01EVT" + "A" * 21,
        fmt="csv",
        mask_pii=True,
        actor_id="01USR" + "B" * 21,
    )
    assert len(task_id) == 26
    redis.hset.assert_awaited_once()
    args, kwargs = redis.hset.await_args
    assert args[0] == f"export:job:{task_id}"
    mapping = kwargs["mapping"]
    assert mapping["status"] == "PENDING"
    assert mapping["mask_pii"] == "1"
    assert mapping["format"] == "csv"
    redis.expire.assert_awaited_once_with(f"export:job:{task_id}", EXPORT_TTL_SEC)
    redis.rpush.assert_awaited_once_with(QUEUE_KEY, task_id)


@pytest.mark.asyncio
async def test_get_state_returns_hgetall_dict() -> None:
    redis = AsyncMock()
    redis.hgetall = AsyncMock(return_value={"task_id": "tid", "status": "PENDING"})
    state = await get_state(redis, "tid")
    assert state == {"task_id": "tid", "status": "PENDING"}


@pytest.mark.asyncio
async def test_get_state_returns_none_for_missing_key() -> None:
    redis = AsyncMock()
    redis.hgetall = AsyncMock(return_value={})
    assert await get_state(redis, "missing") is None


@pytest.mark.asyncio
async def test_pop_pending_returns_lpop_value() -> None:
    redis = AsyncMock()
    redis.lpop = AsyncMock(return_value="tid-1")
    assert await pop_pending(redis) == "tid-1"


@pytest.mark.asyncio
async def test_mark_running_writes_status_and_started_at() -> None:
    redis = AsyncMock()
    await mark_running(redis, "tid")
    redis.hset.assert_awaited_once()
    args, kwargs = redis.hset.await_args
    assert args[0] == "export:job:tid"
    mapping = kwargs["mapping"]
    assert mapping["status"] == "RUNNING"
    assert "started_at" in mapping
    assert "updated_at" in mapping


@pytest.mark.asyncio
async def test_mark_succeeded_writes_object_key() -> None:
    redis = AsyncMock()
    await mark_succeeded(redis, "tid", object_key="exports/evt/tid.csv")
    mapping = redis.hset.await_args.kwargs["mapping"]
    assert mapping["status"] == "SUCCEEDED"
    assert mapping["object_key"] == "exports/evt/tid.csv"


@pytest.mark.asyncio
async def test_mark_failed_truncates_long_error() -> None:
    redis = AsyncMock()
    await mark_failed(redis, "tid", error="x" * 2000)
    mapping = redis.hset.await_args.kwargs["mapping"]
    assert mapping["status"] == "FAILED"
    assert len(mapping["error"]) == 500
