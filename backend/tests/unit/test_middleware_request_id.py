"""X-Request-Id 驗證 — #2 防 DOS"""

import pytest

from app.core.middleware import _normalize_request_id


def test_accepts_valid_uuid() -> None:
    valid = "550e8400-e29b-41d4-a716-446655440000"
    assert _normalize_request_id(valid) == valid


def test_rejects_overlong_string() -> None:
    """37+ 字元 → 不合法,自產 UUID(防 PG CHAR(36) truncation)"""
    long_value = "a" * 200
    out = _normalize_request_id(long_value)
    assert out != long_value
    assert len(out) == 36


def test_rejects_short_non_uuid() -> None:
    out = _normalize_request_id("not-a-uuid")
    assert len(out) == 36


def test_rejects_uuid_with_extra_chars() -> None:
    """36 字長度但格式錯也應 reject"""
    bad = "550e8400-e29b-41d4-a716-44665544000Z" # 末位非 hex
    out = _normalize_request_id(bad)
    assert out != bad


def test_empty_value_generates_uuid() -> None:
    out = _normalize_request_id(None)
    assert len(out) == 36


def test_uppercase_uuid_accepted() -> None:
    """RFC 4122 不限大小寫"""
    upper = "550E8400-E29B-41D4-A716-446655440000"
    assert _normalize_request_id(upper) == upper


@pytest.mark.parametrize(
    "bad_value",
    [
        "<script>alert(1)</script>",
        "'; DROP TABLE audit_logs; --",
        "../../../etc/passwd",
        "request_id_with_unicode_漢字_aaa-bbb-ccc",
    ],
)
def test_rejects_attack_payloads(bad_value: str) -> None:
    out = _normalize_request_id(bad_value)
    assert out != bad_value
    assert len(out) == 36
