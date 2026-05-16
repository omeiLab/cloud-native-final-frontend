"""registration 模組業務例外(對齊設計 06 §8.8 +)。

跨模組共用的(IneligibleError / RegistrationClosedError / AlreadyRegisteredError /
ConfirmationExpiredError)集中於 app.core.exceptions,各模組統一從此 re-export
以保持 import path 對前後相容。

 改動:
- 廢除 v1 DependentsNotAllowedError / DependentLimitExceededError(綁定方案產物)
- 保留 DependentInvalidError(代報時 ownership 驗證失敗)
- 加 AudienceMismatchError(身分跟 ticket_type.audience 不符)
"""

from app.core.exceptions import (
    AlreadyRegisteredError,
    BusinessError,
    ConfirmationExpiredError,
    IneligibleError,
    RegistrationClosedError,
)

__all__ = [
    "AlreadyRegisteredError",
    "AudienceMismatchError",
    "CannotCancelError",
    "CannotForfeitError",
    "ConfirmationExpiredError",
    "DependentInvalidError",
    "IneligibleError",
    "RegistrationClosedError",
    "RegistrationNotFoundError",
]


class RegistrationNotFoundError(BusinessError):
    code = "NOT_FOUND"
    http_status = 404


class CannotCancelError(BusinessError):
    """目前狀態不允許取消(只有 REGISTERED 可以取消)"""

    code = "INVALID_STATE_TRANSITION"
    http_status = 409


class CannotForfeitError(BusinessError):
    """目前狀態不允許棄權(只有 WON 可以棄權)"""

    code = "INVALID_STATE_TRANSITION"
    http_status = 409


class DependentInvalidError(BusinessError):
    """傳入的 as_dependent_id 不屬本人 / 已 INACTIVE / 不存在"""

    code = "DEPENDENT_INVALID"
    http_status = 400


class AudienceMismatchError(BusinessError):
    """:身分跟 ticket_type.audience 不符。

    員工自報時 ticket_type.audience 必須='EMPLOYEE';代報眷屬時必須='DEPENDENT'。
    """

    code = "AUDIENCE_MISMATCH"
    http_status = 400
