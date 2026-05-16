"""Pytest 共用 fixture(基本骨架, 後逐步加 testcontainers fixture)"""

import pytest


@pytest.fixture(autouse=True)
def _set_test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    # JWT 用測試固定 key,讓 token 解碼可預測
    monkeypatch.setenv("JWT_SIGNING_KEY", "test-jwt-key-only-for-pytest-not-production-32-bytes")


@pytest.fixture(autouse=True)
def _stub_lifespan_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    """unit test 不需要真的 DB / Redis,把 lifespan init / close 換成 noop"""

    async def _noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr("app.main.init_db_engines", _noop)
    monkeypatch.setattr("app.main.init_redis", _noop)
    monkeypatch.setattr("app.main.close_db_engines", _noop)
    monkeypatch.setattr("app.main.close_redis", _noop)
