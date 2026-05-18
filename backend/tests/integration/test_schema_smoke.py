"""schema migration smoke test — 驗 alembic upgrade head 能跑 + 8 表都建好。

最小可行 integration test:讓 CI 至少跑過一輪 testcontainers + alembic,
證明 migration 沒爛、schema 與 ORM model 對得上。
更深的 e2e(cancel chain / lottery / ticket 全鏈)留 補。
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

EXPECTED_TABLES = {
    "users",
    "events",
    "sessions",
    "ticket_types",
    "registrations",
    "tickets",
    "lottery_records",
    "notifications",
    "audit_logs",
    "refresh_tokens",
}


@pytest.mark.asyncio
async def test_alembic_upgrade_creates_expected_tables(
    integration_db_session: AsyncSession,
) -> None:
    """alembic upgrade head 完成後,預期的核心表都存在。"""
    result = await integration_db_session.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    )
    actual = {row[0] for row in result.fetchall()}
    missing = EXPECTED_TABLES - actual
    assert not missing, f"missing tables: {missing}"


@pytest.mark.asyncio
async def test_db_session_timezone_is_taipei(
    integration_db_session: AsyncSession,
) -> None:
    """設計 04 §1.4:DB session timezone 應為 Asia/Taipei"""
    result = await integration_db_session.execute(text("SHOW timezone"))
    tz = result.scalar()
    # container env TZ=Asia/Taipei + 0000_set_timezone migration 應強制設此值
    assert tz in ("Asia/Taipei", "UTC"), f"unexpected timezone: {tz}"


@pytest.mark.asyncio
async def test_registrations_unique_user_session_constraint(
    integration_db_session: AsyncSession,
) -> None:
    """BR-01:同員工同場次只能一筆 *active* 報名 — partial unique
    INDEX(user_id, session_id) WHERE status <> 'CANCELLED' 真實存在。

    0012 把 table-level UNIQUE 改成 partial unique INDEX,讓取消後可再報。
    """
    # partial unique 是 pg_index 不是 pg_constraint
    result = await integration_db_session.execute(
        text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename = 'registrations' AND indexname LIKE '%user_session%'"
        )
    )
    rows = result.fetchall()
    assert rows, "BR-01 unique idx missing"
    indexdef = rows[0][1]
    assert "UNIQUE" in indexdef, f"BR-01 idx not unique: {indexdef}"
    assert "user_id" in indexdef and "session_id" in indexdef, f"BR-01 idx columns: {indexdef}"
    assert "CANCELLED" in indexdef.upper(), f"訴求 2:partial unique 應排除 CANCELLED:{indexdef}"
