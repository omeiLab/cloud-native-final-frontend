"""WebSocket Pub/Sub payload HMAC 簽章 / 驗章()。

對齊設計 §Backlog 的 trust assumption 強化:
- publisher(NotificationService._send_websocket)用共享 secret HMAC 簽 payload
- subscriber(PubSubSubscriber._handle_message)驗簽,失敗直接 drop + metric

防護面:
- 任意能 publish redis 的元件(其他 namespace pod、誤配 NetworkPolicy、開 dev tunnel)
  無法冒名推 WS message — 沒有 HMAC key 簽不出有效 sig
- 不防 replay(WS message 推一次即丟,replay 對前端不致命)
- key 由 K8s Secret 注入(WS_PUBSUB_HMAC_KEY env)

訊息格式:JSON object,加 `_sig` 欄位為 base64-urlsafe HMAC-SHA256(key, canonical_payload)
canonical = json.dumps(payload_without_sig, sort_keys=True, separators=(',',':'))
"""

import base64
import hashlib
import hmac
import json
from typing import Any

from app.config import settings


class HmacKeyMissingError(RuntimeError):
    """HMAC key 未設定 — production 不應啟動,lab 啟動時 raise"""


def _get_key() -> bytes:
    if not settings.ws_pubsub_hmac_key:
        raise HmacKeyMissingError("WS_PUBSUB_HMAC_KEY 未設定 — 跨副本 WS 廣播無法驗簽")
    return settings.ws_pubsub_hmac_key.encode()


def _canonical(payload: dict[str, Any]) -> bytes:
    """穩定 serialization:sort keys + 不留空白(避免 publisher / subscriber 漂移)"""
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def sign_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """publisher 用 — 取 payload(不含 _sig)+ 簽,回傳含 _sig 的新 dict"""
    if "_sig" in payload:
        raise ValueError("payload 已含 _sig,不可重複簽")
    sig = hmac.new(_get_key(), _canonical(payload), hashlib.sha256).digest()
    out = dict(payload)
    out["_sig"] = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    return out


def verify_signed_payload(raw: str) -> dict[str, Any] | None:
    """subscriber 用 — 解 JSON、驗 _sig;失敗回 None(caller drop + metric)"""
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    sig_b64 = obj.pop("_sig", None)
    if not isinstance(sig_b64, str):
        return None
    try:
        # 補 base64 padding
        pad = "=" * (-len(sig_b64) % 4)
        provided = base64.urlsafe_b64decode(sig_b64 + pad)
    except (ValueError, TypeError):
        return None
    expected = hmac.new(_get_key(), _canonical(obj), hashlib.sha256).digest()
    if not hmac.compare_digest(provided, expected):
        return None
    return obj
