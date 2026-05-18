"""notification 模組業務例外(對齊設計 06 §11.8 + 05 §4.2)"""

from app.core.exceptions import BusinessError, NotFoundError

__all__ = [
    "NotificationNotFoundError",
    "NotificationSendError",
    "UnknownNotificationTypeError",
]


class NotificationNotFoundError(NotFoundError):
    code = "NOT_FOUND"


class NotificationSendError(BusinessError):
    """三管道任一個發送失敗(SMTP / Redis publish);會被 retry job 撈回重送"""

    code = "INTERNAL_ERROR"
    http_status = 500


class UnknownNotificationTypeError(BusinessError):
    """type 不在 NOTIFICATION_CONFIG 內 — 程式 bug,不該對外發生"""

    code = "INTERNAL_ERROR"
    http_status = 500
