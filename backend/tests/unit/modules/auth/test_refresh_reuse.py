"""Refresh token reuse / race detection — 對齊設計 04 §6 family revocation
+ 補 rate limit + race protection 兩條"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import RateLimitedError
from app.modules.auth import service as auth_service_mod
from app.modules.auth.errors import RefreshTokenInvalidError
from app.modules.auth.service import AuthService


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> AuthService:
    # service.refresh 內呼叫 audit + commit + check_rate_limit;
    # unit 層全 patch 為 noop,各 test 若要驗 rate limit 自行覆寫
    async def _noop_audit(*a: object, **k: object) -> None:
        return None

    async def _noop_rate_limit(*a: object, **k: object) -> None:
        return None

    monkeypatch.setattr(auth_service_mod, "audit", _noop_audit)
    monkeypatch.setattr(auth_service_mod, "check_rate_limit", _noop_rate_limit)

    s = AuthService.__new__(AuthService)
    s.session = AsyncMock()
    s.user_repo = AsyncMock()
    s.refresh_repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_refresh_with_unknown_token_raises_invalid_no_revoke_all(
    svc: AuthService,
) -> None:
    """完全不存在的 token → InvalidError,但不觸發 family revocation"""
    svc.refresh_repo.find_active_by_raw = AsyncMock(return_value=None)
    svc.refresh_repo.find_any_by_raw = AsyncMock(return_value=None)
    svc.refresh_repo.revoke_all_for_user = AsyncMock(return_value=0)

    with pytest.raises(RefreshTokenInvalidError):
        await svc.refresh("never-issued-token")

    svc.refresh_repo.revoke_all_for_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_reuse_of_revoked_token_triggers_family_revocation(
    svc: AuthService,
) -> None:
    """已 revoked 卻被 reuse → 視為 replay,撤銷該 user 整家"""
    revoked_rt = SimpleNamespace(
        id="01HRTXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        revoked_at=datetime.now(UTC),
    )
    svc.refresh_repo.find_active_by_raw = AsyncMock(return_value=None)
    svc.refresh_repo.find_any_by_raw = AsyncMock(return_value=revoked_rt)
    svc.refresh_repo.revoke_all_for_user = AsyncMock(return_value=3)

    with pytest.raises(RefreshTokenInvalidError):
        await svc.refresh("replayed-token")

    svc.refresh_repo.revoke_all_for_user.assert_awaited_once_with("01HUSERXXXXXXXXXXXXXXXXXXX")
    svc.session.commit.assert_awaited() # family revocation 寫進 DB


@pytest.mark.asyncio
async def test_refresh_active_token_rotates_normally(svc: AuthService) -> None:
    active_rt = SimpleNamespace(
        id="01HRTXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUSERXXXXXXXXXXXXXXXXXXX",
        revoked_at=None,
    )
    user = SimpleNamespace(
        id="01HUSERXXXXXXXXXXXXXXXXXXX",
        employee_id="EMP-1",
        name="Tester",
        email="t@e.io",
        site="HSINCHU",
        role="EMPLOYEE",
    )
    svc.refresh_repo.find_active_by_raw = AsyncMock(return_value=active_rt)
    svc.refresh_repo.find_any_by_raw = AsyncMock(return_value=active_rt)
    svc.user_repo.get_by_id = AsyncMock(return_value=user)
    svc.refresh_repo.revoke = AsyncMock(return_value=1) # rowcount=1 = race 贏家
    svc.refresh_repo.revoke_all_for_user = AsyncMock()
    svc.refresh_repo.create = AsyncMock()

    pair = await svc.refresh("good-token")
    assert pair.access_token
    assert pair.refresh_token
    svc.refresh_repo.revoke.assert_awaited_once_with(active_rt.id)
    svc.refresh_repo.revoke_all_for_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_race_loser_triggers_family_revocation(svc: AuthService) -> None:
    """:同一 token 兩個並行 refresh,輸的一方 revoke() rowcount=0 →
    視為 token cloning 攻擊,撤銷該 user 整家"""
    active_rt = SimpleNamespace(
        id="01HRTRACEXXXXXXXXXXXXXXX",
        user_id="01HUSERRACEXXXXXXXXXXXXX",
        revoked_at=None,
    )
    user = SimpleNamespace(
        id="01HUSERRACEXXXXXXXXXXXXX",
        employee_id="EMP-2",
        name="Race",
        email="r@e.io",
        site="HSINCHU",
        role="EMPLOYEE",
    )
    svc.refresh_repo.find_active_by_raw = AsyncMock(return_value=active_rt)
    svc.user_repo.get_by_id = AsyncMock(return_value=user)
    # 關鍵:rowcount=0 表示先到的 request 已把這個 token revoke 了
    svc.refresh_repo.revoke = AsyncMock(return_value=0)
    svc.refresh_repo.revoke_all_for_user = AsyncMock(return_value=2)

    with pytest.raises(RefreshTokenInvalidError):
        await svc.refresh("racing-token", ip_address="10.0.0.5")

    svc.refresh_repo.revoke.assert_awaited_once_with(active_rt.id)
    svc.refresh_repo.revoke_all_for_user.assert_awaited_once_with(active_rt.user_id)


@pytest.mark.asyncio
async def test_refresh_rate_limit_per_ip_blocks_burst(
    svc: AuthService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """:同 IP 30/min 上限 — 第 31 次直接 RateLimitedError,
    不進 token lookup(防暴力枚舉 / 失竊 token 重放洪水)"""

    async def _ratelimit_blocked(*a: object, **k: object) -> None:
        raise RateLimitedError("brute force", details={"limit": 30, "window_seconds": 60})

    monkeypatch.setattr(auth_service_mod, "check_rate_limit", _ratelimit_blocked)

    svc.refresh_repo.find_active_by_raw = AsyncMock()
    svc.refresh_repo.find_any_by_raw = AsyncMock()

    with pytest.raises(RateLimitedError):
        await svc.refresh("any", ip_address="10.0.0.99")

    # rate limit 應在 token lookup 之前 — 防止暴力者把 DB / Redis 打爆
    svc.refresh_repo.find_active_by_raw.assert_not_awaited()
    svc.refresh_repo.find_any_by_raw.assert_not_awaited()
