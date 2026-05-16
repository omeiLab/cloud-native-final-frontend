"""export_drain_job tests — Batch B(A6)

驗 4 條 path:
- queue 空 → idle outcome
- 拿到 task + lock → 跑 _run_export → mark_succeeded
- 拿到 task + lock 但 _run_export 拋 → mark_failed
- 拿到 task 但拿不到 advisory lock → 推回 queue 頭部
"""

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.admin import export_worker
from app.modules.admin.export_worker import export_drain_job


def _mock_session_maker(session: AsyncMock) -> Any:
    @asynccontextmanager
    async def _ctx() -> Any:
        yield session

    return MagicMock(side_effect=lambda: _ctx())


@pytest.mark.asyncio
async def test_drain_idle_when_queue_empty() -> None:
    fake_redis = AsyncMock()
    fake_redis.lpop = AsyncMock(return_value=None)

    with patch.object(export_worker, "get_redis", return_value=fake_redis):
        await export_drain_job()

    # queue 空就早退,不會碰 db session
    fake_redis.hgetall.assert_not_awaited()


@pytest.mark.asyncio
async def test_drain_runs_export_and_marks_succeeded() -> None:
    fake_redis = AsyncMock()
    fake_redis.lpop = AsyncMock(return_value="task-1")
    fake_redis.hgetall = AsyncMock(
        return_value={
            "task_id": "task-1",
            "event_id": "evt-x",
            "format": "csv",
            "mask_pii": "1",
            "status": "PENDING",
        }
    )
    fake_session = AsyncMock()

    with (
        patch.object(export_worker, "get_redis", return_value=fake_redis),
        patch.object(
            export_worker,
            "get_rw_session_maker",
            return_value=_mock_session_maker(fake_session),
        ),
        patch.object(
            export_worker, "try_advisory_xact_lock", new_callable=AsyncMock, return_value=True
        ),
        patch.object(
            export_worker,
            "_run_export",
            new_callable=AsyncMock,
            return_value="exports/evt-x/task-1.csv",
        ) as mock_run,
    ):
        await export_drain_job()

    mock_run.assert_awaited_once()
    # mark_succeeded → 寫 object_key + status SUCCEEDED
    succeeded_calls = [
        c
        for c in fake_redis.hset.await_args_list
        if c.kwargs.get("mapping", {}).get("status") == "SUCCEEDED"
    ]
    assert len(succeeded_calls) == 1
    assert succeeded_calls[0].kwargs["mapping"]["object_key"] == "exports/evt-x/task-1.csv"
    fake_session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_drain_marks_failed_on_run_export_exception() -> None:
    fake_redis = AsyncMock()
    fake_redis.lpop = AsyncMock(return_value="task-2")
    fake_redis.hgetall = AsyncMock(
        return_value={
            "task_id": "task-2",
            "event_id": "evt-y",
            "format": "csv",
            "mask_pii": "0",
            "status": "PENDING",
        }
    )
    fake_session = AsyncMock()

    with (
        patch.object(export_worker, "get_redis", return_value=fake_redis),
        patch.object(
            export_worker,
            "get_rw_session_maker",
            return_value=_mock_session_maker(fake_session),
        ),
        patch.object(
            export_worker, "try_advisory_xact_lock", new_callable=AsyncMock, return_value=True
        ),
        patch.object(
            export_worker,
            "_run_export",
            new_callable=AsyncMock,
            side_effect=RuntimeError("storage broken"),
        ),
    ):
        await export_drain_job()

    failed_calls = [
        c
        for c in fake_redis.hset.await_args_list
        if c.kwargs.get("mapping", {}).get("status") == "FAILED"
    ]
    assert len(failed_calls) == 1
    assert "storage broken" in failed_calls[0].kwargs["mapping"]["error"]
    fake_session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_drain_pushes_back_when_advisory_lock_unavailable() -> None:
    fake_redis = AsyncMock()
    fake_redis.lpop = AsyncMock(return_value="task-3")
    fake_session = AsyncMock()

    with (
        patch.object(export_worker, "get_redis", return_value=fake_redis),
        patch.object(
            export_worker,
            "get_rw_session_maker",
            return_value=_mock_session_maker(fake_session),
        ),
        patch.object(
            export_worker, "try_advisory_xact_lock", new_callable=AsyncMock, return_value=False
        ),
        patch.object(export_worker, "_run_export", new_callable=AsyncMock) as mock_run,
    ):
        await export_drain_job()

    mock_run.assert_not_awaited()
    fake_redis.lpush.assert_awaited_once()
    args = fake_redis.lpush.await_args.args
    assert args[1] == "task-3" # 推回 queue
    fake_session.rollback.assert_awaited()
