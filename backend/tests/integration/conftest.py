"""Integration test fixtures — testcontainers postgres + redis(全修)。

對齊投產審查 §C-4:把 integration / contract / e2e 真正放進 CI,讓
NFR 5.7 80% 覆蓋率不只是「跑 unit + 期望 PR 沒漏」。

範圍邊界(補完):
- 目前只提供 schema migration + DB session fixture
- contract test(schemathesis)、E2E test(httpx ASGI)、跨 Pod WS 測試
  各自需獨立 fixture,留 逐項加
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

ROOT = Path(__file__).resolve().parent.parent.parent


# 整批 integration test 共用一個 postgres + redis container
# (避免每 test spin up 浪費 30+ 秒)


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[PostgresContainer]:
    """單一 postgres:16 container,session lifecycle。

    dbname 必須是 `cets`(migration 0000 hardcoded `ALTER DATABASE cets...`)。
    """
    with PostgresContainer(
        "postgres:16-alpine",
        driver="psycopg2",
        dbname="cets",
        username="cets",
        password="cets",
    ) as pg:
        # set timezone alignment(設計 04 §1.4)
        pg.with_env("TZ", "Asia/Taipei")
        yield pg


@pytest.fixture(scope="session")
def redis_container() -> Iterator[RedisContainer]:
    """單一 redis:7 container,session lifecycle"""
    with RedisContainer("redis:7-alpine") as rc:
        yield rc


@pytest.fixture(scope="session")
def alembic_upgraded_db(postgres_container: PostgresContainer) -> str:
    """跑 alembic upgrade head 對 container db,回傳 asyncpg URL。

    第一個用到的 test 會觸發 migration;之後共用 schema。
    """
    sync_url = postgres_container.get_connection_url() # postgresql+psycopg2://...
    cfg = AlembicConfig(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", sync_url)
    command.upgrade(cfg, "head")
    # 回 async URL 給 app 用
    return sync_url.replace("postgresql+psycopg2", "postgresql+asyncpg", 1)


@pytest.fixture
async def integration_db_session(alembic_upgraded_db: str) -> AsyncIterator[AsyncSession]:
    """每 test 一個 AsyncSession,結束自動 rollback(讓 DB 維持乾淨)"""
    engine = create_async_engine(alembic_upgraded_db, pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        try:
            yield session
        finally:
            await session.rollback()
    await engine.dispose()


@pytest.fixture(autouse=True)
def _override_settings(
    monkeypatch: pytest.MonkeyPatch,
    alembic_upgraded_db: str,
    redis_container: RedisContainer,
) -> None:
    """把 settings 的 DB / Redis URL 換成 container 的"""
    redis_url = (
        f"redis://{redis_container.get_container_host_ip()}:"
        f"{redis_container.get_exposed_port(6379)}/0"
    )
    monkeypatch.setenv("DATABASE_URL_RW", alembic_upgraded_db)
    monkeypatch.setenv("DATABASE_URL_RO", alembic_upgraded_db)
    monkeypatch.setenv("REDIS_URL", redis_url)
    # 跳過 OIDC dep 檢查
    monkeypatch.setenv("AUTH0_DOMAIN", "test.auth0.com")
    monkeypatch.setenv("OIDC_PROVIDER", "mock-oidc")
    # ENVIRONMENT 給 settings 看
    monkeypatch.setenv("ENVIRONMENT", "test")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """所有 tests/integration 下的 test 自動加 integration marker"""
    integration_dir = Path(__file__).resolve().parent
    for item in items:
        if integration_dir in Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.integration)


# CI 上沒 docker 時跳過(local dev 也可手動 skip:`pytest -m 'not integration'`)

if os.environ.get("CETS_SKIP_INTEGRATION") == "1":
    pytest.skip("CETS_SKIP_INTEGRATION=1 — 跳過 integration tests", allow_module_level=True)
