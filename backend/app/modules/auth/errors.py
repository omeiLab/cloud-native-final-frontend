"""auth 模組例外"""

from app.core.exceptions import (
    BusinessError,
    ForbiddenError,
    TokenExpiredError,
    UnauthenticatedError,
)


class InvalidStateError(BusinessError):
    code = "INVALID_STATE"
    http_status = 400


class OIDCExchangeError(BusinessError):
    code = "OIDC_EXCHANGE_FAILED"
    http_status = 502


class RefreshTokenInvalidError(BusinessError):
    code = "REFRESH_TOKEN_INVALID"
    http_status = 401


class DependentNotFoundError(BusinessError):
    code = "DEPENDENT_NOT_FOUND"
    http_status = 404


class DependentAlreadyExistsError(BusinessError):
    code = "DEPENDENT_ALREADY_EXISTS"
    http_status = 409


__all__ = [
    "BusinessError",
    "DependentAlreadyExistsError",
    "DependentNotFoundError",
    "ForbiddenError",
    "InvalidStateError",
    "OIDCExchangeError",
    "RefreshTokenInvalidError",
    "TokenExpiredError",
    "UnauthenticatedError",
]
