"""跨模組共用列舉值 — 對齊資料庫設計書 §4 各表 status"""

from enum import StrEnum


class Role(StrEnum):
    EMPLOYEE = "EMPLOYEE"
    # fix:細分 ADMIN RBAC(舊 ADMIN 仍是最高權限,新增 VIEWER 限唯讀)
    # ADMIN — 全權限(read + write + 拉 PII 明文)
    # ADMIN_VIEWER — 唯讀:dashboard / list(僅 mask_pii=true)/ sites count
    ADMIN = "ADMIN"
    ADMIN_VIEWER = "ADMIN_VIEWER"
    VERIFIER = "VERIFIER"
    # — 員工眷屬,不獨立登入,由員工代為操作
    DEPENDENT = "DEPENDENT"


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class Site(StrEnum):
    HSINCHU = "HSINCHU"
    TAINAN = "TAINAN"
    TAICHUNG = "TAICHUNG"
    TAIPEI = "TAIPEI"
    OVERSEAS = "OVERSEAS"


class EventStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    CANCELLED = "CANCELLED"


class SessionStatus(StrEnum):
    REGISTRATION_OPEN = "REGISTRATION_OPEN"
    REGISTRATION_CLOSED = "REGISTRATION_CLOSED"
    LOTTERY_RUNNING = "LOTTERY_RUNNING"
    LOTTERY_COMPLETED = "LOTTERY_COMPLETED"
    FINALIZED = "FINALIZED"
    ONGOING = "ONGOING"
    CLOSED = "CLOSED"


class RegistrationStatus(StrEnum):
    REGISTERED = "REGISTERED"
    CANCELLED = "CANCELLED"
    IN_LOTTERY = "IN_LOTTERY"
    WON = "WON"
    LOST = "LOST"
    WAITLISTED = "WAITLISTED"
    CONFIRMED = "CONFIRMED"
    FORFEITED = "FORFEITED"
    EXPIRED = "EXPIRED"
    USED = "USED"


class TicketStatus(StrEnum):
    ISSUED = "ISSUED"
    USED = "USED"
    REVOKED = "REVOKED"


class NotificationChannel(StrEnum):
    EMAIL = "EMAIL"
    IN_APP = "IN_APP"
    WEBSOCKET = "WEBSOCKET"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class EligibilityReason(StrEnum):
    """check_eligibility 不通過的結構化原因(避免 caller 用字串比對 reason)"""

    SITE_MISMATCH = "SITE_MISMATCH"
    SESSION_NOT_OPEN = "SESSION_NOT_OPEN"
    REGISTRATION_NOT_YET_OPEN = "REGISTRATION_NOT_YET_OPEN"
    REGISTRATION_CLOSED = "REGISTRATION_CLOSED"


class DependentRelationship(StrEnum):
    """員工眷屬關係()"""

    SPOUSE = "SPOUSE"
    CHILD = "CHILD"
    PARENT = "PARENT"
    OTHER = "OTHER"


class DependentStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
