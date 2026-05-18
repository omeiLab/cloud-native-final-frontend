"""get_client_meta — IP 驗證 + UA cap(fix)"""

from unittest.mock import MagicMock

import pytest

from app.core.middleware import _UA_MAX_LEN, _safe_ip, get_client_meta


def _make_request(headers: dict[str, str], client_host: str | None = "10.0.0.5") -> MagicMock:
    req = MagicMock()
    req.state.request_id = "fixed-rid"
    req.headers = headers
    req.client = MagicMock(host=client_host) if client_host else None
    return req


def test_safe_ip_accepts_valid_v4_v6() -> None:
    assert _safe_ip("203.0.113.5") == "203.0.113.5"
    assert _safe_ip("2001:db8::1") == "2001:db8::1"


@pytest.mark.parametrize(
    "bad",
    [
        "not-an-ip",
        "999.999.999.999",
        "<script>alert(1)</script>",
        "127.0.0.1; DROP TABLE",
        "",
        " ",
        None,
    ],
)
def test_safe_ip_rejects_bad(bad: str | None) -> None:
    assert _safe_ip(bad) is None


def test_get_client_meta_uses_xff_when_valid() -> None:
    req = _make_request({"x-forwarded-for": "203.0.113.5"})
    _, ip, _ = get_client_meta(req)
    assert ip == "203.0.113.5"


def test_get_client_meta_falls_back_to_socket_when_xff_invalid() -> None:
    """攻擊 payload XFF: not-an-ip → 不應觸發 PG INET parse error,fallback 到 socket"""
    req = _make_request({"x-forwarded-for": "not-an-ip"}, client_host="10.0.0.5")
    _, ip, _ = get_client_meta(req)
    assert ip == "10.0.0.5"


def test_get_client_meta_returns_none_when_all_invalid() -> None:
    req = _make_request({"x-forwarded-for": "not-an-ip"}, client_host="garbage")
    _, ip, _ = get_client_meta(req)
    assert ip is None


def test_user_agent_capped() -> None:
    """16MB UA → 截到 512 字防 DOS"""
    long_ua = "Mozilla/" + "X" * 5000
    req = _make_request({"user-agent": long_ua})
    _, _, ua = get_client_meta(req)
    assert ua is not None
    assert len(ua) == _UA_MAX_LEN


def test_user_agent_short_unchanged() -> None:
    req = _make_request({"user-agent": "curl/7.88.1"})
    _, _, ua = get_client_meta(req)
    assert ua == "curl/7.88.1"


def test_request_id_pulled_from_state() -> None:
    req = _make_request({})
    rid, _, _ = get_client_meta(req)
    assert rid == "fixed-rid"
