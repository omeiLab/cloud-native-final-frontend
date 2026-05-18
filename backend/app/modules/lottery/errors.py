"""lottery 模組業務例外(對齊設計 06 §9.7)"""

from app.core.exceptions import BusinessError, NotFoundError

# event 模組已定義 SessionNotFoundError(code='SESSION_NOT_FOUND'),lottery 直接 re-export
from app.modules.event.errors import SessionNotFoundError

__all__ = [
    "LotteryAlreadyExecutedError",
    "LotteryRecordNotFoundError",
    "LotteryReplayMismatchError",
    "SessionNotFoundError",
]


class LotteryRecordNotFoundError(NotFoundError):
    """找不到對應 lottery_records(session+ticket_type 沒抽過 → replay_for_audit 用)"""

    code = "LOTTERY_RECORD_NOT_FOUND"


class LotteryAlreadyExecutedError(BusinessError):
    """同 session_id + ticket_type_id 已抽過(冪等命中)— 只在 service 層內部 sentinel,不對外"""

    code = "CONFLICT"
    http_status = 409


class LotteryReplayMismatchError(BusinessError):
    """replay 結果與原紀錄不一致 — 演算法或 seed 處理出問題"""

    code = "INTERNAL_ERROR"
    http_status = 500
