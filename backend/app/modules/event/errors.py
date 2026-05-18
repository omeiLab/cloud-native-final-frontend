"""event 模組例外(對齊設計 06 §7.8)。

IneligibleError / RegistrationClosedError 已於 後集中到
app.core.exceptions(統一 http_status),這裡 re-export 維持 import path 相容。
"""

from app.core.exceptions import (
    BusinessError,
    EventNotFoundError,
    IneligibleError,
    NotFoundError,
    RegistrationClosedError,
)

__all__ = [
    "BusinessError",
    "CannotModifyPublishedFieldError",
    "EventNotFoundError",
    "IneligibleError",
    "InvalidEventStateError",
    "RegistrationClosedError",
    "RegistrationNotOpenError",
    "SessionNotFoundError",
    "TicketTypeNotFoundError",
]


class SessionNotFoundError(NotFoundError):
    code = "SESSION_NOT_FOUND"


class TicketTypeNotFoundError(NotFoundError):
    code = "TICKET_TYPE_NOT_FOUND"


class RegistrationNotOpenError(BusinessError):
    code = "REGISTRATION_NOT_OPEN"
    http_status = 400


class InvalidEventStateError(BusinessError):
    code = "INVALID_STATE_TRANSITION"
    http_status = 409


class CannotModifyPublishedFieldError(BusinessError):
    """BR-11:活動發布後 allowed_sites / 配額 / 抽籤時間不可改"""

    code = "INVALID_STATE_TRANSITION"
    http_status = 409
