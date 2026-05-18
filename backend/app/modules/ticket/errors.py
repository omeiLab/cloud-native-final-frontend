"""ticket 模組業務例外(對齊設計 06 §10.9 + 05 §4.2)。

跨模組共用的(ConfirmationExpiredError / EventNotStartedError / EventEndedError)
集中於 app.core.exceptions,本模組從此 re-export 以保持 import path 對前後相容。
"""

from app.core.exceptions import (
    BusinessError,
    ConfirmationExpiredError,
    EventEndedError,
    EventNotStartedError,
    NotFoundError,
)

__all__ = [
    "ConfirmationExpiredError",
    "EventEndedError",
    "EventNotStartedError",
    "TicketAlreadyIssuedError",
    "TicketAlreadyUsedError",
    "TicketInvalidError",
    "TicketNotFoundError",
    "TicketRevokedError",
]


class TicketNotFoundError(NotFoundError):
    code = "TICKET_NOT_FOUND"


class TicketInvalidError(BusinessError):
    """JWT 驗簽失敗、過期、claim 不對"""

    code = "TICKET_INVALID"
    http_status = 400


class TicketAlreadyUsedError(BusinessError):
    code = "TICKET_ALREADY_USED"
    http_status = 409


class TicketRevokedError(BusinessError):
    code = "TICKET_REVOKED"
    http_status = 409


class TicketAlreadyIssuedError(BusinessError):
    """同 registration 已發過票券(uniq_tickets_registration 命中) — BR-05 防雙票。
    設計 06 §10.9 列 7 個業務例外,本條為實作補充(對應 UNIQUE 違反)。
    """

    code = "TICKET_ALREADY_ISSUED"
    http_status = 409
