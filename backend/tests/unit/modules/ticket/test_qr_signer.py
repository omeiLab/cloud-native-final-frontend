"""QR signer roundtrip + 過期 + tamper 測試(設計 06 §10.6)"""

import time

import jwt
import pytest

from app.core.qr_signer import QRSigner


def test_sign_verify_roundtrip(qr_signer: QRSigner) -> None:
    token, exp = qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
    )
    claims = qr_signer.verify_ticket_payload(token)
    assert claims["tid"] == "01HTKXXXXXXXXXXXXXXXXXXXXX"
    assert claims["uid"] == "01HUUXXXXXXXXXXXXXXXXXXXXX"
    assert claims["sid"] == "01HSSSXXXXXXXXXXXXXXXXXXXX"
    assert claims["v"] == 1
    # exp 是 int 秒(JWT spec);sign_ticket 回 datetime 帶 microseconds,故用 int 比對
    assert int(exp.timestamp()) == claims["exp"]


def test_expired_token_rejected(qr_signer: QRSigner) -> None:
    """exp 設成過去 + 超過 leeway → ExpiredSignatureError"""
    # leeway=5s,要設超過才會 raise;直接 -120s/-60s 確保會被拒
    expired_payload = {
        "iss": "cets-tickets",
        "aud": "ticket-verify",
        "tid": "01HTKXXXXXXXXXXXXXXXXXXXXX",
        "uid": "01HUUXXXXXXXXXXXXXXXXXXXXX",
        "sid": "01HSSSXXXXXXXXXXXXXXXXXXXX",
        "iat": int(time.time()) - 120,
        "exp": int(time.time()) - 60,
        "v": 1,
    }
    expired_token = jwt.encode(
        expired_payload,
        qr_signer._private_key_pem, # type: ignore[attr-defined]
        algorithm="EdDSA",
        headers={"kid": "test"},
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        qr_signer.verify_ticket_payload(expired_token)


def test_wrong_audience_rejected(qr_signer: QRSigner) -> None:
    """aud 不對 → InvalidAudienceError"""
    payload = {
        "iss": "cets-tickets",
        "aud": "some-other-purpose", # 不對
        "tid": "01HTKXXXXXXXXXXXXXXXXXXXXX",
        "uid": "u",
        "sid": "s",
        "iat": int(time.time()),
        "exp": int(time.time()) + 60,
        "v": 1,
    }
    token = jwt.encode(
        payload,
        qr_signer._private_key_pem, # type: ignore[attr-defined]
        algorithm="EdDSA",
        headers={"kid": "test"},
    )
    with pytest.raises(jwt.InvalidAudienceError):
        qr_signer.verify_ticket_payload(token)


def test_wrong_issuer_rejected(qr_signer: QRSigner) -> None:
    """iss 不對 → InvalidIssuerError(防 cross-purpose attack)"""
    payload = {
        "iss": "some-other-issuer", # 不對
        "aud": "ticket-verify",
        "tid": "01HTKXXXXXXXXXXXXXXXXXXXXX",
        "uid": "u",
        "sid": "s",
        "iat": int(time.time()),
        "exp": int(time.time()) + 60,
        "v": 1,
    }
    token = jwt.encode(
        payload,
        qr_signer._private_key_pem, # type: ignore[attr-defined]
        algorithm="EdDSA",
        headers={"kid": "test"},
    )
    with pytest.raises(jwt.InvalidIssuerError):
        qr_signer.verify_ticket_payload(token)


def test_tampered_token_rejected(qr_signer: QRSigner) -> None:
    """簽章中段改字元 → InvalidSignatureError"""
    token, _ = qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
    )
    # JWT 三段 a.b.c;改 signature 中段 byte(避開末位的 base64 padding 等價)
    parts = token.split(".")
    sig = parts[2]
    mid = len(sig) // 2
    flipped_char = "B" if sig[mid] != "B" else "C"
    tampered_sig = sig[:mid] + flipped_char + sig[mid + 1:]
    tampered = ".".join([parts[0], parts[1], tampered_sig])
    with pytest.raises(jwt.InvalidSignatureError):
        qr_signer.verify_ticket_payload(tampered)


def test_tampered_payload_rejected(qr_signer: QRSigner) -> None:
    """改 payload 段(改 tid)→ 簽章不符"""
    token, _ = qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
    )
    parts = token.split(".")
    # 解 payload 改 tid 再 base64 編回去 — 此測試只驗 「簽章不符」
    import base64
    import json

    raw = base64.urlsafe_b64decode(parts[1] + "==")
    obj = json.loads(raw)
    obj["tid"] = "BADTICKETXXXXXXXXXXXXXXXXX"
    new_payload = base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()
    tampered = ".".join([parts[0], new_payload, parts[2]])
    with pytest.raises(jwt.InvalidSignatureError):
        qr_signer.verify_ticket_payload(tampered)


def test_wrong_algorithm_rejected(qr_signer: QRSigner) -> None:
    """其他 algorithm 簽的 token 不接受"""
    fake_token = jwt.encode(
        {"tid": "x", "uid": "u", "sid": "s", "exp": 9999999999},
        "secret",
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        qr_signer.verify_ticket_payload(fake_token)
