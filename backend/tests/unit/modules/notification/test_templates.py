"""notification templates / NOTIFICATION_CONFIG 對齊設計 06 §11.4"""

import pytest

from app.modules.notification.errors import UnknownNotificationTypeError
from app.modules.notification.templates import (
    NOTIFICATION_CONFIG,
    get_default_channels,
    render_notification,
)


def test_config_has_9_types() -> None:
    """設計 05 §12.1 列 9 個 type(:補 CONFIRMATION_EXPIRED)"""
    assert len(NOTIFICATION_CONFIG) == 9
    expected = {
        "REGISTRATION_CONFIRMED",
        "LOTTERY_WON",
        "LOTTERY_LOST",
        "WAITLISTED",
        "WAITLIST_PROMOTED",
        "CONFIRMATION_REMINDER",
        "CONFIRMATION_EXPIRED",
        "EVENT_CANCELLED",
        "EVENT_REMINDER",
    }
    assert set(NOTIFICATION_CONFIG.keys()) == expected


def test_lottery_lost_only_in_app() -> None:
    """LOTTERY_LOST 只發 IN_APP(避免大量無感 email,設計 §11.4)"""
    assert NOTIFICATION_CONFIG["LOTTERY_LOST"]["channels"] == ["IN_APP"]


def test_get_default_channels_unknown_raises() -> None:
    with pytest.raises(UnknownNotificationTypeError):
        get_default_channels("NOT_A_TYPE")


def test_render_lottery_won_includes_payload() -> None:
    rendered = render_notification(
        type="LOTTERY_WON",
        user={"name": "Alice", "email": "a@example.com"},
        payload={
            "event_title": "家庭日",
            "confirmation_deadline": " 23:59",
        },
    )
    assert "家庭日" in rendered.title
    assert "Alice" in rendered.body_email
    assert " 23:59" in rendered.body_email
    assert "家庭日" in rendered.body_text


def test_render_lottery_lost_no_email_body() -> None:
    """LOTTERY_LOST 不寄信 → body_email 為空,呼叫端應視為跳過"""
    rendered = render_notification(
        type="LOTTERY_LOST",
        user={"name": "Bob", "email": "b@example.com"},
        payload={"event_title": "家庭日"},
    )
    assert rendered.body_email == ""
    assert "家庭日" in rendered.body_text


def test_render_missing_payload_var_raises() -> None:
    """StrictUndefined:payload 缺 event_title → raise"""
    from jinja2 import UndefinedError

    with pytest.raises(UndefinedError):
        render_notification(
            type="LOTTERY_WON",
            user={"name": "Alice", "email": "a@example.com"},
            payload={}, # 缺 event_title
        )


def test_render_unknown_type_raises() -> None:
    with pytest.raises(UnknownNotificationTypeError):
        render_notification(
            type="NOT_A_TYPE",
            user={"name": "x", "email": "x@x"},
            payload={},
        )


def test_render_email_html_escapes_user_input() -> None:
    """autoescape:HTML body 不該被 user.name 注入 <script>"""
    rendered = render_notification(
        type="LOTTERY_WON",
        user={"name": "<script>alert(1)</script>", "email": "a@a"},
        payload={"event_title": "x", "confirmation_deadline": "x"},
    )
    assert "<script>" not in rendered.body_email
    assert "&lt;script&gt;" in rendered.body_email
