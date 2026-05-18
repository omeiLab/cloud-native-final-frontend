"""Fix #6:get_current_user 必須拒絕 status != 'ACTIVE' 的使用者。

被禁用 / 離職員工持有效 token 時若不擋,違反 BR / 安全模型。
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import UnauthenticatedError
from app.modules.auth.dependencies import get_current_user


def _make_request() -> SimpleNamespace:
    """假 Request,只需要.state 可被賦值"""
    return SimpleNamespace(state=SimpleNamespace())


def _make_creds(token: str = "fake.token.here") -> SimpleNamespace: # noqa: S107 — test fixture
    return SimpleNamespace(scheme="Bearer", credentials=token)


@pytest.mark.asyncio
async def test_inactive_user_with_valid_token_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """status='INACTIVE' 即使 token 簽章有效仍須 raise UnauthenticatedError"""
    from app.modules.auth import dependencies as deps_mod

    async def _fake_verify(_token: str) -> dict[str, str]:
        return {"sub": "01HUUSERXXXXXXXXXXXXXXXXXX", "jti": "j1"}

    monkeypatch.setattr(deps_mod.AuthService, "verify_access_token", _fake_verify)

    inactive_user = SimpleNamespace(
        id="01HUUSERXXXXXXXXXXXXXXXXXX",
        employee_id="E0001",
        name="王小明",
        email="x@example.com",
        department="DEV",
        site="HSINCHU",
        role="EMPLOYEE",
        status="INACTIVE",
    )
    auth_svc = AsyncMock()
    auth_svc.get_user_by_id = AsyncMock(return_value=inactive_user)

    with pytest.raises(UnauthenticatedError, match="停權"):
        await get_current_user(_make_request(), _make_creds(), auth_svc)


@pytest.mark.asyncio
async def test_active_user_with_valid_token_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """status='ACTIVE' 走 happy path,正常回 user"""
    from app.modules.auth import dependencies as deps_mod

    async def _fake_verify(_token: str) -> dict[str, str]:
        return {"sub": "01HUUSERXXXXXXXXXXXXXXXXXX", "jti": "j1"}

    monkeypatch.setattr(deps_mod.AuthService, "verify_access_token", _fake_verify)

    active_user = SimpleNamespace(
        id="01HUUSERXXXXXXXXXXXXXXXXXX",
        employee_id="E0002",
        name="張三",
        email="z@example.com",
        department="DEV",
        site="HSINCHU",
        role="EMPLOYEE",
        status="ACTIVE",
    )
    auth_svc = AsyncMock()
    auth_svc.get_user_by_id = AsyncMock(return_value=active_user)

    result = await get_current_user(_make_request(), _make_creds(), auth_svc)
    assert result is active_user
