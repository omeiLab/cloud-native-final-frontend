"""業務例外基底類別 + 全域 exception handler(對齊設計 §14)"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger

logger = get_logger(__name__)


class BusinessError(Exception):
    """所有業務例外的基底"""

    code: str = "BUSINESS_ERROR"
    http_status: int = 400
    message: str = ""

    def __init__(
        self,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(BusinessError):
    code = "VALIDATION_ERROR"
    http_status = 400


class NotFoundError(BusinessError):
    code = "NOT_FOUND"
    http_status = 404


class ConflictError(BusinessError):
    code = "CONFLICT"
    http_status = 409


class ForbiddenError(BusinessError):
    code = "FORBIDDEN"
    http_status = 403


class UnauthenticatedError(BusinessError):
    code = "UNAUTHENTICATED"
    http_status = 401


class TokenExpiredError(BusinessError):
    code = "TOKEN_EXPIRED"
    http_status = 401


class RateLimitedError(BusinessError):
    code = "RATE_LIMITED"
    http_status = 429


class ServiceUnavailableError(BusinessError):
    code = "SERVICE_UNAVAILABLE"
    http_status = 503


# ─── 跨模組共用業務例外(避免各模組重複定義不同 http_status) ───


class IneligibleError(BusinessError):
    """廠區資格不符 / 員工身分不符(設計 05 §4 INELIGIBLE)"""

    code = "INELIGIBLE"
    http_status = 403


class RegistrationClosedError(BusinessError):
    """報名期間外 / 場次已截止(設計 05 §4 REGISTRATION_CLOSED)"""

    code = "REGISTRATION_CLOSED"
    http_status = 409


class AlreadyRegisteredError(BusinessError):
    """同 user 同 session 已有報名(BR-01)"""

    code = "ALREADY_REGISTERED"
    http_status = 409


class ConfirmationExpiredError(BusinessError):
    """confirmation_deadline 已過,中籤者已不能 confirm(BR-06)。
    registration / ticket 兩個入口都會踩到,集中於此避免重複定義。
    """

    code = "CONFIRMATION_EXPIRED"
    http_status = 410


class EventNotStartedError(BusinessError):
    """活動尚未開始(starts_at - 30min 之前)— BR-07。
    現由 ticket.verify 使用;將來 attendance / admin 也會用到,集中於 core。
    """

    code = "EVENT_NOT_STARTED"
    http_status = 403


class EventEndedError(BusinessError):
    """活動已結束(ends_at + 30min 之後)— BR-07"""

    code = "EVENT_ENDED"
    http_status = 410


class EventNotFoundError(NotFoundError):
    """活動不存在 — event / admin 模組共用(:去重定義)"""

    code = "EVENT_NOT_FOUND"


def _success_false_envelope(
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details:
        err["details"] = details
    if request_id and "details" not in err:
        err["details"] = {"request_id": request_id}
    elif request_id:
        err["details"]["request_id"] = request_id
    return {"success": False, "error": err}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BusinessError)
    async def handle_business_error(request: Request, exc: BusinessError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=exc.http_status,
            content=_success_false_envelope(exc.code, exc.message, exc.details, request_id),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=400,
            content=_success_false_envelope(
                "VALIDATION_ERROR",
                "請求格式錯誤,欄位不合法",
                {"errors": exc.errors()},
                request_id,
            ),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.exception(
            "unexpected_error",
            request_id=request_id,
            path=request.url.path,
            method=request.method,
        )
        return JSONResponse(
            status_code=500,
            content=_success_false_envelope(
                "INTERNAL_ERROR",
                "系統錯誤,請稍後再試",
                request_id=request_id,
            ),
        )
