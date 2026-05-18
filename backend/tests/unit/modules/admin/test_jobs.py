"""archive_old_events_job tests — advisory lock 取不到 / 取到的兩條 path"""

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.admin.archiver import ArchiveResult
from app.modules.admin.jobs import archive_old_events_job


def _mock_session_maker(session: AsyncMock) -> Any:
    """sessionmaker() 回 async ctx manager,yield session"""

    @asynccontextmanager
    async def _ctx() -> Any:
        yield session

    mock = MagicMock(side_effect=lambda: _ctx())
    return mock


@pytest.mark.asyncio
async def test_archive_skips_when_lock_held() -> None:
    fake_session = AsyncMock()
    with (
        patch(
            "app.modules.admin.jobs.get_rw_session_maker",
            return_value=_mock_session_maker(fake_session),
        ),
        patch(
            "app.modules.admin.jobs.try_advisory_xact_lock",
            new_callable=AsyncMock,
            return_value=False,
        ) as mock_lock,
    ):
        await archive_old_events_job()
        mock_lock.assert_awaited_once()
        fake_session.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_archive_runs_when_lock_acquired() -> None:
    fake_session = AsyncMock()
    with (
        patch(
            "app.modules.admin.jobs.get_rw_session_maker",
            return_value=_mock_session_maker(fake_session),
        ),
        patch(
            "app.modules.admin.jobs.try_advisory_xact_lock",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "app.modules.admin.jobs.archive_old_events",
            new_callable=AsyncMock,
            return_value=ArchiveResult(candidates=[], dry_run=True),
        ) as mock_archive,
    ):
        await archive_old_events_job()
        fake_session.commit.assert_awaited_once()
        mock_archive.assert_awaited_once()
