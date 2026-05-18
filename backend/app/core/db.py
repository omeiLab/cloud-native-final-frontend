"""SQLAlchemy async engine — CNPG `-rw` (寫) / `-ro` (讀) 兩組,讀寫分離"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    pass


_rw_engine: AsyncEngine | None = None
_ro_engine: AsyncEngine | None = None
_rw_session_maker: async_sessionmaker[AsyncSession] | None = None
_ro_session_maker: async_sessionmaker[AsyncSession] | None = None


def _ensure_asyncpg(url: str) -> str:
    """CNPG / generic postgresql:// → postgresql+asyncpg:// for create_async_engine"""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def init_db_engines(rw_url: str, ro_url: str) -> None:
    global _rw_engine, _ro_engine, _rw_session_maker, _ro_session_maker
    rw_url = _ensure_asyncpg(rw_url)
    ro_url = _ensure_asyncpg(ro_url)
    _rw_engine = create_async_engine(
        rw_url,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        echo=False,
    )
    _ro_engine = create_async_engine(
        ro_url,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        echo=False,
    )
    _rw_session_maker = async_sessionmaker(_rw_engine, expire_on_commit=False)
    _ro_session_maker = async_sessionmaker(_ro_engine, expire_on_commit=False)
    logger.info("db_engines_initialized", rw=_mask(rw_url), ro=_mask(ro_url))


async def close_db_engines() -> None:
    global _rw_engine, _ro_engine
    if _rw_engine is not None:
        await _rw_engine.dispose()
        _rw_engine = None
    if _ro_engine is not None:
        await _ro_engine.dispose()
        _ro_engine = None
    logger.info("db_engines_closed")


async def get_rw_session() -> AsyncIterator[AsyncSession]:
    if _rw_session_maker is None:
        raise RuntimeError("DB rw engine not initialized")
    async with _rw_session_maker() as session:
        yield session


async def get_ro_session() -> AsyncIterator[AsyncSession]:
    if _ro_session_maker is None:
        raise RuntimeError("DB ro engine not initialized")
    async with _ro_session_maker() as session:
        yield session


def get_rw_session_maker() -> async_sessionmaker[AsyncSession]:
    """非 FastAPI 用的 session 工廠(APScheduler 任務 / runner / lifespan 內部用)"""
    if _rw_session_maker is None:
        raise RuntimeError("DB rw engine not initialized")
    return _rw_session_maker


async def check_db_connectivity() -> None:
    """讀 / 寫 endpoint 各打一次 SELECT 1"""
    from sqlalchemy import text

    if _rw_engine is None or _ro_engine is None:
        raise RuntimeError("DB engines not initialized")

    async with _rw_engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    async with _ro_engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


def _mask(url: str) -> str:
    """遮掉密碼"""
    if "://" not in url:
        return url
    proto, rest = url.split("://", 1)
    if "@" in rest:
        creds, host = rest.split("@", 1)
        if ":" in creds:
            user = creds.split(":", 1)[0]
            return f"{proto}://{user}:***@{host}"
    return url
