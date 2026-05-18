"""JWT denylist revocation 行為測試(對齊設計 04 §6.2)"""

from unittest.mock import AsyncMock

import pytest

from app.core import redis as redis_mod


@pytest.mark.asyncio
async def test_add_jwt_to_denylist_skips_when_negative_ttl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """已過期的 jti 不再寫 Redis(節流)"""
    fake_redis = AsyncMock()
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    await redis_mod.add_jwt_to_denylist("jti-xxx", ttl_seconds=-5)
    fake_redis.set.assert_not_called()


@pytest.mark.asyncio
async def test_add_jwt_to_denylist_clamps_min_60s(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """clock skew:剛過 0s 也保底 60s"""
    fake_redis = AsyncMock()
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    await redis_mod.add_jwt_to_denylist("jti-xxx", ttl_seconds=10)
    fake_redis.set.assert_awaited_once_with("jwt:denylist:jti-xxx", "1", ex=60)


@pytest.mark.asyncio
async def test_add_jwt_to_denylist_uses_remaining_ttl_when_large(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_redis = AsyncMock()
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    await redis_mod.add_jwt_to_denylist("jti-zzz", ttl_seconds=900)
    fake_redis.set.assert_awaited_once_with("jwt:denylist:jti-zzz", "1", ex=900)


@pytest.mark.asyncio
async def test_is_jwt_revoked_true_when_key_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(return_value=1)
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    assert await redis_mod.is_jwt_revoked("jti-blocked") is True


@pytest.mark.asyncio
async def test_is_jwt_revoked_false_when_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(return_value=0)
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    assert await redis_mod.is_jwt_revoked("jti-fresh") is False


@pytest.mark.asyncio
async def test_permanent_dev_user_bypasses_denylist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ 全修:三個固定 ULID 對應的 token bypass Redis denylist。
    即使 jti 已加入 denylist,decode_and_verify_token 仍回 claims。
    這是讓前端 / e2e 永久 token 不會被 logout 廢掉的設計。
    """
    from datetime import UTC, datetime

    import jwt as pyjwt

    from app.config import settings
    from app.core import security as sec

    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(return_value=1) # 模擬 jti 已被撤銷
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    dev_uid = "01E2EADMINTSMCROLEXXXXXXXX"
    assert dev_uid in sec.PERMANENT_DEV_USER_IDS
    payload = {
        "sub": dev_uid,
        "jti": "e2e-perm-admin",
        "iss": settings.service_url,
        "exp": int(datetime(2099, 12, 31, tzinfo=UTC).timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    tok = pyjwt.encode(
        payload,
        settings.jwt_signing_key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_kid},
    )

    claims = await sec.decode_and_verify_token(tok)
    assert claims["sub"] == dev_uid
    fake_redis.exists.assert_not_called() # bypass:沒 call denylist


@pytest.mark.asyncio
async def test_normal_user_still_blocked_by_denylist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非 PERMANENT_DEV_USER_IDS 的 token 仍走 denylist 撤銷邏輯"""
    from datetime import UTC, datetime

    import jwt as pyjwt

    from app.config import settings
    from app.core import security as sec
    from app.core.exceptions import UnauthenticatedError

    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(return_value=1)
    monkeypatch.setattr(redis_mod, "_redis", fake_redis)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: fake_redis)

    payload = {
        "sub": "01NORMALEMPLOYEEXXXXXXXXXX",
        "jti": "real-user-jti",
        "iss": settings.service_url,
        "exp": int(datetime(2099, 12, 31, tzinfo=UTC).timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    tok = pyjwt.encode(
        payload,
        settings.jwt_signing_key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_kid},
    )

    with pytest.raises(UnauthenticatedError):
        await sec.decode_and_verify_token(tok)
    fake_redis.exists.assert_called_once()
