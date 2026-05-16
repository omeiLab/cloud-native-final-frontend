"""通知類型對應 channels 與 Jinja2 模板(設計 06 §11.4)。

每個 type 對齊 design 06 §11.4 的 NOTIFICATION_CONFIG。
範本以 inline string 表達(避免散在多檔案,8 種 type x 3 channel 規模可控);
若 admin 後台要改範本,再考慮 DB-backed 模板。

Email = HTML、IN_APP / WEBSOCKET 用純文字(WS payload 只取 title + body 走 JSON 結構)。
"""

from typing import Any, Final

from jinja2 import Environment, StrictUndefined

from app.modules.notification.errors import UnknownNotificationTypeError

# autoescape only matters for HTML; FastAPI 不會把 jinja 結果直接 inject 到 page,
# 但 email body 進使用者收件夾,還是 escape 一下安全
_jinja = Environment(
    autoescape=True,
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)


# 通知類型配置(對齊設計 06 §11.4)

NOTIFICATION_CONFIG: Final[dict[str, dict[str, Any]]] = {
    "REGISTRATION_CONFIRMED": {
        "channels": ["EMAIL", "IN_APP", "WEBSOCKET"],
        "priority": "normal",
    },
    "LOTTERY_WON": {
        "channels": ["EMAIL", "IN_APP", "WEBSOCKET"],
        "priority": "high",
    },
    "LOTTERY_LOST": {
        # 未中籤不發 Email,避免大量無感通知(設計 06 §11.4)
        "channels": ["IN_APP"],
        "priority": "low",
    },
    "WAITLISTED": {
        "channels": ["EMAIL", "IN_APP", "WEBSOCKET"],
        "priority": "normal",
    },
    "WAITLIST_PROMOTED": {
        "channels": ["EMAIL", "IN_APP", "WEBSOCKET"],
        "priority": "high",
    },
    "CONFIRMATION_REMINDER": {
        "channels": ["EMAIL", "IN_APP"],
        "priority": "normal",
    },
    "CONFIRMATION_EXPIRED": {
        # 中籤者逾期未確認 → expire_overdue_won 後通知本人(設計 05 §12.1)
        "channels": ["EMAIL", "IN_APP"],
        "priority": "normal",
    },
    "EVENT_CANCELLED": {
        "channels": ["EMAIL", "IN_APP", "WEBSOCKET"],
        "priority": "high",
    },
    "EVENT_REMINDER": {
        "channels": ["EMAIL", "IN_APP"],
        "priority": "normal",
    },
}


# 範本(title + body 兩段;email body 用 HTML、其他用 plain text 簡寫)
# 變數慣例:user.{name, email} + payload.{event_title, session_starts_at,...}
# 模板用 StrictUndefined,缺變數直接 raise — caller 必須給足

_TEMPLATES: Final[dict[str, dict[str, str]]] = {
    "REGISTRATION_CONFIRMED": {
        "title": "報名成功 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>您已成功報名 <b>{{ payload.event_title }}</b>"
            "({{ payload.session_starts_at }}),抽籤公告日:"
            "{{ payload.lottery_at }}。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": ("您已成功報名 {{ payload.event_title }}({{ payload.session_starts_at }})。"),
    },
    "LOTTERY_WON": {
        "title": "恭喜中籤 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>恭喜!您報名的 <b>{{ payload.event_title }}</b> 已中籤。"
            "請於 {{ payload.confirmation_deadline }} 前確認出席,"
            "逾期視同棄權。</p>"
            "<p>確認後系統會發放您與隨行眷屬(若有)的票券,"
            "請至『我的票券』查看完整清單。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": (
            "恭喜!{{ payload.event_title }} 已中籤,請於 "
            "{{ payload.confirmation_deadline }} 前確認。"
            "確認後可至『我的票券』查看您與眷屬(若有)的票券。"
        ),
    },
    "LOTTERY_LOST": {
        "title": "未中籤 — {{ payload.event_title }}",
        "body_email": "", # 此型別不寄信
        "body_text": ("{{ payload.event_title }} 抽籤結果為未中籤,歡迎參加其他活動。"),
    },
    "WAITLISTED": {
        "title": "候補中 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>您報名的 <b>{{ payload.event_title }}</b> 進入候補序號 "
            "{{ payload.waitlist_position }}。中籤者放棄 / 逾期確認時將自動遞補。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": ("{{ payload.event_title }} 進入候補(序號 {{ payload.waitlist_position }})。"),
    },
    "WAITLIST_PROMOTED": {
        "title": "候補遞補成功 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>您候補中的 <b>{{ payload.event_title }}</b> 已遞補為中籤,"
            "請於 {{ payload.confirmation_deadline }} 前確認出席。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": (
            "{{ payload.event_title }} 已遞補成功,請於 {{ payload.confirmation_deadline }} 前確認。"
        ),
    },
    "CONFIRMATION_REMINDER": {
        "title": "確認提醒 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>您中籤的 <b>{{ payload.event_title }}</b> "
            "確認期限為 {{ payload.confirmation_deadline }},還剩 "
            "{{ payload.hours_remaining }} 小時。逾期將自動釋出名額予候補。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": (
            "{{ payload.event_title }} 確認倒數 {{ payload.hours_remaining }} 小時,逾期視同棄權。"
        ),
    },
    "CONFIRMATION_EXPIRED": {
        "title": "確認逾期 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>您中籤的 <b>{{ payload.event_title }}</b> 已過確認期限"
            "({{ payload.deadline }}),系統已自動釋出名額予候補。"
            "歡迎報名其他活動。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": ("{{ payload.event_title }} 確認期限已過,名額已釋出予候補。"),
    },
    "EVENT_CANCELLED": {
        "title": "活動取消 — {{ payload.event_title }}",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>原訂的 <b>{{ payload.event_title }}</b> 已取消,原因:"
            "{{ payload.reason }}。如已收到票券,該票券同步作廢。"
            "造成不便敬請見諒。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": ("{{ payload.event_title }} 已取消({{ payload.reason }})。"),
    },
    "EVENT_REMINDER": {
        "title": "活動提醒 — {{ payload.event_title }} 即將開始",
        "body_email": (
            "<p>{{ user.name }} 您好,</p>"
            "<p>提醒您 <b>{{ payload.event_title }}</b> 將於 "
            "{{ payload.session_starts_at }} 開始,別忘了出示票券 QR 入場。</p>"
            "<p>— CETS</p>"
        ),
        "body_text": ("提醒:{{ payload.event_title }} 將於 {{ payload.session_starts_at }} 開始。"),
    },
}


class RenderedNotification:
    """渲染結果 — title / body_email(HTML) / body_text"""

    __slots__ = ("body_email", "body_text", "title")

    def __init__(self, title: str, body_email: str, body_text: str) -> None:
        self.title = title
        self.body_email = body_email
        self.body_text = body_text


def render_notification(
    *,
    type: str,
    user: dict[str, Any],
    payload: dict[str, Any] | None,
) -> RenderedNotification:
    """以 type 取對應範本渲染。user 至少有 {name, email}。

    payload 為 None 時用 {} — 範本若引用 missing key 會 raise(StrictUndefined)。
    UnknownNotificationTypeError 表示 caller 給了非法 type(程式 bug)。
    """
    if type not in _TEMPLATES:
        raise UnknownNotificationTypeError(f"未知通知類型 {type}")
    spec = _TEMPLATES[type]
    ctx: dict[str, Any] = {"user": user, "payload": payload or {}}
    return RenderedNotification(
        title=_jinja.from_string(spec["title"]).render(**ctx),
        body_email=_jinja.from_string(spec["body_email"]).render(**ctx)
        if spec["body_email"]
        else "",
        body_text=_jinja.from_string(spec["body_text"]).render(**ctx),
    )


def get_default_channels(type: str) -> list[str]:
    if type not in NOTIFICATION_CONFIG:
        raise UnknownNotificationTypeError(f"未知通知類型 {type}")
    return list(NOTIFICATION_CONFIG[type]["channels"])


__all__ = [
    "NOTIFICATION_CONFIG",
    "RenderedNotification",
    "get_default_channels",
    "render_notification",
]
