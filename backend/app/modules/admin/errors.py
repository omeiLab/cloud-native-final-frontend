"""admin 模組業務例外。

跨模組共用的(EventNotFoundError)集中於 app.core.exceptions(:
admin / event 同 code 同義 raise 的兩個 class 已合併)。
"""

from app.core.exceptions import BusinessError, EventNotFoundError

__all__ = [
    "EventNotFoundError",
    "ExportFailedError",
    "ExportTaskNotFoundError",
    "ExportTaskNotReadyError",
    "ExportTooLargeError",
]


class ExportFailedError(BusinessError):
    """匯出失敗 — 通常是 IO / serializer 錯誤"""

    code = "INTERNAL_ERROR"
    http_status = 500


class ExportTooLargeError(BusinessError):
    """匯出資料超過同步上限(設計 06 §12.6 < 5000)—:防 OOM
    + 集中外洩;production 應走背景任務 + MinIO"""

    code = "EXPORT_TOO_LARGE"
    http_status = 413


class ExportTaskNotFoundError(BusinessError):
    """ Batch B(A6):背景化 export task 不存在或已過期(TTL 1 day)"""

    code = "EXPORT_TASK_NOT_FOUND"
    http_status = 404


class ExportTaskNotReadyError(BusinessError):
    """ Batch B(A6):export task 還在 PENDING / RUNNING 或 FAILED,download 尚不可用"""

    code = "EXPORT_TASK_NOT_READY"
    http_status = 409
