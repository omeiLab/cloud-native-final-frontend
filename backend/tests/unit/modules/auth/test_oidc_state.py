"""OIDC callback state 驗證 — 對齊設計 04 §3 (CSRF + nonce)"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth import service as auth_service_mod
from app.modules.auth.errors import InvalidStateError
from app.modules.auth.service import AuthService


@pytest.fixture
def svc() -> AuthService:
    s = AuthService.__new__(AuthService)
    s.session = AsyncMock()
    s.user_repo = AsyncMock()
    s.refresh_repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_callback_rejects_unknown_state(
    svc: AuthService, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value=None)
    fake_redis.delete = AsyncMock()
    monkeypatch.setattr(auth_service_mod, "get_redis", lambda: fake_redis)

    with pytest.raises(InvalidStateError):
        await svc.oidc_callback(code="auth-code-xxx", state="non-existent-state")

    # delete 不該被呼叫(get 已先回 None)
    fake_redis.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_callback_rejects_replayed_state_after_first_use(
    svc: AuthService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """state 用過後就 delete,第二次打同 state 應失敗"""
    state_payload = json.dumps({"nonce": "nonce-zzz", "code_verifier": "verifier-yyy"})
    used = SimpleNamespace(count=0)

    async def fake_get(_key: str) -> str | None:
        if used.count == 0:
            used.count += 1
            return state_payload
        return None

    fake_redis = AsyncMock()
    fake_redis.get = fake_get # type: ignore[assignment]
    fake_redis.delete = AsyncMock()
    monkeypatch.setattr(auth_service_mod, "get_redis", lambda: fake_redis)

    # 第二次必失敗(get 回 None)
    used.count = 1
    with pytest.raises(InvalidStateError):
        await svc.oidc_callback(code="another-code", state="replayed-state")


@pytest.mark.asyncio
async def test_callback_rejects_corrupt_state_payload(
    svc: AuthService, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value="not-a-json-{")
    fake_redis.delete = AsyncMock()
    monkeypatch.setattr(auth_service_mod, "get_redis", lambda: fake_redis)

    with pytest.raises(InvalidStateError):
        await svc.oidc_callback(code="code-xxx", state="bad-payload-state")
