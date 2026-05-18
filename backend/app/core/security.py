"""JWT 簽發 / 驗證 — 對齊設計 6.4 + Plan §6.4(JWT 帶 kid: v1)"""

import secrets
from datetime import datetime, timedelta
from typing import Any

import jwt as pyjwt

from app.config import settings
from app.core.exceptions import TokenExpiredError, UnauthenticatedError
from app.core.redis import is_jwt_revoked
from app.core.time import now_utc

# 全修(永久 dev token):這三個固定 ULID 對應的 token bypass Redis
# denylist 檢查,確保前端開發 / e2e 永久可用(logout 不影響)。
# ⚠️ production stable 後務必:
# 1. 刪除此 set(此檔)
# 2. DELETE 三個固定 ULID 的 dev user(`scripts/cleanup-dev-users.sql` TBD)
# 3. rotate `cets-jwt-signing-key` Secret(三個 token 立刻全失效)
#:加 production 守衛 — production 環境直接視為「永遠 deny」
# 任何 PERMANENT_DEV_USER_IDS 的 token,避免 backdoor 因部署疏忽而生效。
PERMANENT_DEV_USER_IDS: frozenset[str] = frozenset(
    {
        "01E2EADMINTSMCROLEXXXXXXXX",
        "01E2EEMPLOYEETSMCROLEXXXXX",
        "01E2EVERIFIERTSMCROLEXXXXX",
    }
)


def _is_dev_bypass_allowed() -> bool:
    """環境守衛:lab / dev / staging 允許 dev token bypass denylist;
    production 一律拒(無論 token 是否在 set 裡,production 都不該有這條路徑)。
    """
    return settings.environment.lower() in {"dev", "development", "lab", "staging", "test"}


def generate_jti() -> str:
    """JWT ID — Redis denylist 用"""
    return secrets.token_urlsafe(16)


def encode_access_token(
    sub: str,
    claims: dict[str, Any] | None = None,
    ttl_seconds: int | None = None,
) -> tuple[str, str, datetime]:
    """簽發 access token,回傳 (token, jti, exp)"""
    jti = generate_jti()
    now = now_utc()
    exp = now + timedelta(seconds=ttl_seconds or settings.access_token_ttl_seconds)
    payload: dict[str, Any] = {
        "sub": sub,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "iss": settings.service_url,
    }
    if claims:
        payload.update(claims)
    token = pyjwt.encode(
        payload,
        settings.jwt_signing_key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_kid},
    )
    return token, jti, exp


async def decode_and_verify_token(token: str) -> dict[str, Any]:
    """驗 JWT 簽章 + 過期 + Redis denylist;回傳 claims"""
    try:
        claims: dict[str, Any] = pyjwt.decode(
            token,
            settings.jwt_signing_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.service_url,
        )
    except pyjwt.ExpiredSignatureError as e:
        raise TokenExpiredError("Access token 已過期") from e
    except pyjwt.InvalidTokenError as e:
        raise UnauthenticatedError("Access token 無效") from e

    # Permanent dev token bypass:三個固定 ULID 的 token 不查 denylist,
    # 即使 logout 加 jti 進 Redis 也仍 valid。production 由 _is_dev_bypass_allowed
    # 守衛拒絕(:無論 set 是否清空,production 都不走 bypass)。
    if claims.get("sub") in PERMANENT_DEV_USER_IDS:
        if not _is_dev_bypass_allowed():
            raise UnauthenticatedError("Permanent dev token 在 production 環境被拒")
        return claims

    jti = claims.get("jti")
    if jti and await is_jwt_revoked(jti):
        raise UnauthenticatedError("Access token 已被撤銷")

    return claims


def jwt_remaining_ttl(claims: dict[str, Any]) -> int:
    """JWT 還剩幾秒過期(用於 denylist TTL)"""
    exp = claims.get("exp")
    if not isinstance(exp, int):
        return 0
    remaining = exp - int(now_utc().timestamp())
    return max(remaining, 0)
