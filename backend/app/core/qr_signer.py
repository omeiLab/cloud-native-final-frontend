"""QR Code EdDSA 簽章 / 驗章(設計 06 §10.6)

QR Code 內容為 EdDSA 簽章的 JWT,每 60 秒輪替:
- payload:tid / uid / sid / iat / exp / v / iss / aud
- header:kid(預設 v1,future 換 key 才會改)+ alg=EdDSA
- 私鑰:K8s Secret cets-ticket-signing-key(只 main-api 拿)
- 公鑰:可預載驗票裝置離線驗簽

 R4 後加 iss/aud 防 cross-purpose attack(若同對 EdDSA key 未來簽其他用途,
本 verify 端點不會接受跨用途 token)。leeway=5 秒處理多 pod NTP 漂移。
"""

from datetime import datetime, timedelta
from typing import Any

import jwt

from app.config import settings
from app.core.logging import get_logger
from app.core.time import now_utc

logger = get_logger(__name__)

_ALG = "EdDSA"

#:固定 iss/aud,鎖死「票券簽 / 票券驗」用途
_QR_ISS = "cets-tickets"
_QR_AUD = "ticket-verify"
# 多 pod NTP 漂移容忍(秒),設大會放鬆過期判斷,設小可能誤拒
_VERIFY_LEEWAY_SECONDS = 5


class QRSigner:
    """單例 — 啟動時讀私鑰一次,後續 sign 直接用記憶體 PEM。"""

    def __init__(
        self,
        private_key_pem: str,
        public_key_pem: str | None,
        kid: str,
        ttl_seconds: int,
    ) -> None:
        if not private_key_pem:
            raise RuntimeError("TICKET_SIGNING_PRIVATE_KEY 未設定 — main-api 無法產生 QR token")
        self._private_key_pem = private_key_pem
        # public 沒設可從 private 推:lab 階段 main-api 自己也要驗(get_ticket_with_qr 不需驗,
        # verify_and_use_ticket 會用,所以一定要可用)
        self._public_key_pem = public_key_pem or _derive_public_pem(private_key_pem)
        self._kid = kid
        self._ttl_seconds = ttl_seconds

    def sign_ticket(self, *, ticket_id: str, user_id: str, session_id: str) -> tuple[str, datetime]:
        """產 QR JWT;回傳 (token, expires_at)"""
        now = now_utc()
        expires_at = now + timedelta(seconds=self._ttl_seconds)
        payload: dict[str, Any] = {
            "iss": _QR_ISS,
            "aud": _QR_AUD,
            "tid": ticket_id,
            "uid": user_id,
            "sid": session_id,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
            "v": 1,
        }
        token = jwt.encode(
            payload,
            self._private_key_pem,
            algorithm=_ALG,
            headers={"kid": self._kid},
        )
        return token, expires_at

    def verify_ticket_payload(self, token: str) -> dict[str, Any]:
        """驗 JWT 簽章 + exp + iss/aud;回傳 claims dict。失敗統一 raise jwt.InvalidTokenError"""
        claims: dict[str, Any] = jwt.decode(
            token,
            self._public_key_pem,
            algorithms=[_ALG],
            audience=_QR_AUD,
            issuer=_QR_ISS,
            leeway=_VERIFY_LEEWAY_SECONDS,
        )
        return claims


def _derive_public_pem(private_pem: str) -> str:
    """從 PKCS8 PEM 私鑰推導公鑰 PEM(SubjectPublicKeyInfo)"""
    from cryptography.hazmat.primitives import serialization

    priv = serialization.load_pem_private_key(private_pem.encode(), password=None)
    return (
        priv.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )


_signer: QRSigner | None = None


def get_qr_signer() -> QRSigner:
    """lazy 初始化(避免 import-time 讀 settings,測試易 patch)"""
    global _signer
    if _signer is None:
        _signer = QRSigner(
            private_key_pem=settings.ticket_signing_private_key,
            public_key_pem=settings.ticket_signing_public_key or None,
            kid=settings.ticket_signing_kid,
            ttl_seconds=settings.ticket_qr_ttl_seconds,
        )
    return _signer


def reset_qr_signer() -> None:
    """測試用:清掉 singleton,讓下次 get_qr_signer 重讀 settings"""
    global _signer
    _signer = None
