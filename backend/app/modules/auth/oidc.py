"""OIDC client wrapper — Auth0(主用)/ mock-oidc(fallback)
含 ID Token 驗證(JWKS RS256)、PKCE S256、nonce
"""

import base64
import functools
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient

from app.config import settings
from app.core.logging import get_logger
from app.modules.auth.errors import OIDCExchangeError

logger = get_logger(__name__)

_DISCOVERY_TTL_SECONDS = 3600
_JWKS_TTL_SECONDS = 3600


@dataclass
class _CachedDiscovery:
    data: dict[str, Any]
    expires_at: float


class OIDCConfig:
    def __init__(
        self,
        issuer: str,
        client_id: str,
        client_secret: str,
        callback_url: str,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.callback_url = callback_url
        self._discovery_cache: _CachedDiscovery | None = None
        self._jwks_client: PyJWKClient | None = None
        self._jwks_expires_at: float = 0.0

    async def discovery(self) -> dict[str, Any]:
        now = time.time()
        if self._discovery_cache is not None and self._discovery_cache.expires_at > now:
            return self._discovery_cache.data
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.issuer}/.well-known/openid-configuration")
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
        self._discovery_cache = _CachedDiscovery(data=data, expires_at=now + _DISCOVERY_TTL_SECONDS)
        return data

    async def jwks(self) -> PyJWKClient:
        now = time.time()
        if self._jwks_client is not None and self._jwks_expires_at > now:
            return self._jwks_client
        discovery = await self.discovery()
        jwks_uri = discovery["jwks_uri"]
        # PyJWKClient 內建快取 fetched signing keys
        self._jwks_client = PyJWKClient(jwks_uri, cache_keys=True)
        self._jwks_expires_at = now + _JWKS_TTL_SECONDS
        return self._jwks_client

    @property
    def is_mock(self) -> bool:
        return "mock-oidc" in self.issuer or self.issuer.startswith("http://")

    @property
    def issuer_with_slash(self) -> str:
        # Auth0 的 id_token iss claim 結尾固定有 /
        return f"{self.issuer}/"


@functools.cache
def get_oidc_config() -> OIDCConfig:
    """singleton — 共用 discovery / JWKS cache;測試需 reset_oidc_config()"""
    if settings.oidc_provider == "mock":
        return OIDCConfig(
            issuer=settings.mock_oidc_issuer,
            client_id=settings.mock_oidc_client_id,
            client_secret=settings.mock_oidc_client_secret,
            callback_url=settings.auth0_callback_url,
        )
    return OIDCConfig(
        issuer=settings.auth0_issuer,
        client_id=settings.auth0_client_id,
        client_secret=settings.auth0_client_secret,
        callback_url=settings.auth0_callback_url,
    )


def reset_oidc_config() -> None:
    """測試用:清 singleton 快取"""
    get_oidc_config.cache_clear()


def generate_state() -> str:
    """CSRF 防護用 state(暫存於 Redis 5 分鐘,callback 比對)"""
    return secrets.token_urlsafe(32)


def generate_nonce() -> str:
    """OIDC nonce — 防 ID token replay,綁在 id_token 內"""
    return secrets.token_urlsafe(32)


def generate_pkce_pair() -> tuple[str, str]:
    """PKCE S256 → (code_verifier, code_challenge)"""
    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


async def build_authorize_url(
    state: str,
    nonce: str,
    code_challenge: str,
    scope: str = "openid profile email",
    redirect_uri: str | None = None,
) -> str:
    """組瀏覽器導向 URL(state + nonce + PKCE S256)

    redirect_uri:若 None 用 config.callback_url(預設);若帶值由 caller 端負責先
    驗證在白名單內(`AuthService.build_authorize_url` 做白名單檢查)。
    """
    config = get_oidc_config()
    discovery = await config.discovery()
    auth_endpoint = discovery["authorization_endpoint"]
    params = {
        "response_type": "code",
        "client_id": config.client_id,
        "redirect_uri": redirect_uri or config.callback_url,
        "scope": scope,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{auth_endpoint}?{urlencode(params)}"


async def exchange_code_for_claims(
    code: str,
    *,
    code_verifier: str,
    nonce: str,
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    """換 token + 驗 id_token + 回 claims dict

    Production(Auth0):驗 id_token RS256 簽章 + iss/aud/exp/nonce。
    Mock-oidc:不驗簽,改打 userinfo;nonce 仍比對(若 mock 帶)。
    """
    config = get_oidc_config()
    discovery = await config.discovery()

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            discovery["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri or config.callback_url,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "code_verifier": code_verifier,
            },
        )
        if token_resp.status_code != 200:
            logger.error(
                "oidc_token_exchange_failed",
                status=token_resp.status_code,
                body=token_resp.text[:300],
            )
            raise OIDCExchangeError("OIDC token exchange 失敗")
        tokens = token_resp.json()
        id_token: str | None = tokens.get("id_token")
        access_token: str | None = tokens.get("access_token")
        if not id_token or not access_token:
            raise OIDCExchangeError("OIDC 回應缺 id_token / access_token")

        if config.is_mock:
            userinfo_resp = await client.get(
                discovery["userinfo_endpoint"],
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if userinfo_resp.status_code != 200:
                raise OIDCExchangeError("mock-oidc userinfo 失敗")
            mock_claims: dict[str, Any] = userinfo_resp.json()
            return mock_claims

        try:
            jwks_client = await config.jwks()
            signing_key = jwks_client.get_signing_key_from_jwt(id_token)
            claims: dict[str, Any] = jwt.decode(
                id_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=config.client_id,
                issuer=config.issuer_with_slash,
            )
        except jwt.InvalidTokenError as e:
            logger.warning("oidc_id_token_invalid", error=str(e))
            raise OIDCExchangeError(f"id_token 驗證失敗: {e}") from e

        if claims.get("nonce") != nonce:
            logger.warning("oidc_nonce_mismatch", expected=nonce, got=claims.get("nonce"))
            raise OIDCExchangeError("id_token nonce 不符")

        return claims
