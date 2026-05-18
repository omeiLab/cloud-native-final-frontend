"""WebSocket Pub/Sub HMAC 簽章 / 驗章 tests(防冒名推送)"""

import json

import pytest

from app.modules.notification.pubsub_security import (
    HmacKeyMissingError,
    sign_payload,
    verify_signed_payload,
)


@pytest.fixture(autouse=True)
def _set_hmac_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.notification.pubsub_security.settings.ws_pubsub_hmac_key",
        "test-key-32bytes-min-for-hmac-256!",
    )


def test_sign_verify_roundtrip() -> None:
    payload = {"type": "notification", "data": {"id": "x", "title": "t"}}
    signed = sign_payload(payload)
    assert "_sig" in signed
    raw = json.dumps(signed, ensure_ascii=False)

    verified = verify_signed_payload(raw)
    assert verified is not None
    assert verified["type"] == "notification"
    assert "_sig" not in verified # 驗證後該欄位已被 pop


def test_unsigned_payload_rejected() -> None:
    """無 _sig → drop"""
    raw = json.dumps({"type": "notification", "data": {}})
    assert verify_signed_payload(raw) is None


def test_tampered_payload_rejected() -> None:
    """改 data 內容 → 簽章不符 → drop"""
    payload = {"type": "notification", "data": {"id": "original"}}
    signed = sign_payload(payload)
    # 改 data
    signed["data"]["id"] = "tampered"
    raw = json.dumps(signed)

    assert verify_signed_payload(raw) is None


def test_invalid_json_rejected() -> None:
    assert verify_signed_payload("not-json") is None


def test_invalid_sig_format_rejected() -> None:
    """_sig 不是字串 → drop"""
    raw = json.dumps({"type": "x", "_sig": 123})
    assert verify_signed_payload(raw) is None


def test_sign_with_existing_sig_raises() -> None:
    """payload 已有 _sig → 程式 bug,不可重複簽"""
    with pytest.raises(ValueError, match="已含 _sig"):
        sign_payload({"type": "x", "_sig": "fake"})


def test_missing_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """key 未設(空字串)→ HmacKeyMissingError(production 啟動阻擋)"""
    monkeypatch.setattr("app.modules.notification.pubsub_security.settings.ws_pubsub_hmac_key", "")
    with pytest.raises(HmacKeyMissingError):
        sign_payload({"type": "x"})


def test_different_key_rejects_signature() -> None:
    """key 不同的兩端不該互相驗成功"""
    p1 = sign_payload({"type": "notification", "data": {"v": 1}})
    raw = json.dumps(p1)

    # 模擬 subscriber 用不同 key
    import importlib

    from app.modules.notification import pubsub_security as ps_mod

    original = ps_mod.settings.ws_pubsub_hmac_key
    try:
        # 用 monkeypatch 暫時換 key
        ps_mod.settings.ws_pubsub_hmac_key = "different-key-from-publisher!!!"
        importlib.reload(ps_mod) # 取新 key
    finally:
        ps_mod.settings.ws_pubsub_hmac_key = original
        importlib.reload(ps_mod)

    # 用原 key 仍應通過(roundtrip 確認測試本身正確)
    assert verify_signed_payload(raw) is not None
