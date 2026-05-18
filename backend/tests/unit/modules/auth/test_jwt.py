"""JWT 簽發 / 驗證單元測試"""

import pytest

from app.core.security import decode_and_verify_token, encode_access_token, jwt_remaining_ttl


@pytest.mark.asyncio
async def test_encode_decode_roundtrip(monkeypatch):
    # 簽發一個 token
    token, jti, exp = encode_access_token(
        sub="01H8XXXXXXXXXXXXXXXXXXXXXX",
        claims={"role": "EMPLOYEE", "site": "HSINCHU"},
        ttl_seconds=60,
    )
    assert token
    assert jti
    assert exp.timestamp() > 0

    # mock Redis denylist 都當作沒在 denylist
    async def _no_revoke(_jti):
        return False

    monkeypatch.setattr("app.core.security.is_jwt_revoked", _no_revoke)

    claims = await decode_and_verify_token(token)
    assert claims["sub"] == "01H8XXXXXXXXXXXXXXXXXXXXXX"
    assert claims["role"] == "EMPLOYEE"
    assert claims["site"] == "HSINCHU"
    assert claims["jti"] == jti


def test_jwt_remaining_ttl_zero_when_expired():
    assert jwt_remaining_ttl({"exp": 0}) == 0
    assert jwt_remaining_ttl({}) == 0


def test_jwt_remaining_ttl_positive_for_future():
    import time

    future = int(time.time()) + 100
    ttl = jwt_remaining_ttl({"exp": future})
    assert 95 <= ttl <= 100
