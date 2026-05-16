"""ticket 模組共用 fixture(EdDSA keypair + mocked service)"""

from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from app.core.qr_signer import QRSigner
from app.modules.ticket import service as ticket_service_mod
from app.modules.ticket.service import TicketService


@pytest.fixture
def ed25519_keypair() -> tuple[str, str]:
    """測試專用 keypair(每次 session 重產一次)"""
    priv = ed25519.Ed25519PrivateKey.generate()
    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    pub_pem = (
        priv.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return priv_pem, pub_pem


@pytest.fixture
def qr_signer(ed25519_keypair: tuple[str, str]) -> QRSigner:
    priv, pub = ed25519_keypair
    return QRSigner(
        private_key_pem=priv,
        public_key_pem=pub,
        kid="test",
        ttl_seconds=60,
    )


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch, qr_signer: QRSigner) -> TicketService:
    """mocked TicketService:repo / event_svc / registration_svc / session 全 AsyncMock。
    qr_signer 用真的(用 fixture 產 keypair),便於 sign+verify 端到端測試。
    """

    async def _noop_audit(*a: object, **k: object) -> None:
        return None

    monkeypatch.setattr(ticket_service_mod, "audit", _noop_audit)

    s = TicketService.__new__(TicketService)
    s.session = AsyncMock()
    s.event_svc = AsyncMock()
    s.registration_svc = AsyncMock()
    s.qr_signer = qr_signer
    s.repo = AsyncMock()
    return s
