"""event 模組 API request / response schemas

PagedResult 移到 app.shared.pagination 之後,event/api.py 直接從那邊 import,
本模組不再 re-export(避免雙 import path 並存)。
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

__all__ = [
    "CancelEventRequest",
    "CreateEventRequest",
    "CreateSessionRequest",
    "CreateTicketTypeRequest",
    "UpdateEventRequest",
    "UpdateSessionRequest",
]

# Request schemas


class CreateEventRequest(BaseModel):
    """:廢除 v1 allow_dependents/max_dependents_per_employee。
    眷屬支援改由 ticket_types.audience='DEPENDENT' 表達。
    """

    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    cover_image_url: str | None = Field(default=None, max_length=2048)
    allowed_sites: list[str] = Field(default_factory=list)


class UpdateEventRequest(BaseModel):
    """允許修改非關鍵欄位(BR-11);發布後 allowed_sites 不可改"""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    cover_image_url: str | None = Field(default=None, max_length=2048)
    allowed_sites: list[str] | None = None


class CreateSessionRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    venue: str = Field(..., min_length=1, max_length=200)
    starts_at: datetime
    ends_at: datetime
    registration_opens_at: datetime
    registration_closes_at: datetime
    lottery_at: datetime
    waitlist_close_at: datetime
    confirmation_deadline_hours: int = Field(default=48, ge=1, le=168)

    @field_validator("ends_at")
    @classmethod
    def _ends_after_starts(cls, v: datetime, info: object) -> datetime:
        # 詳細時間順序由 DB CHECK chk_sessions_time_order 強制;這裡只做 best-effort
        return v


class CreateTicketTypeRequest(BaseModel):
    """:加 audience 區分員工 / 眷屬池"""

    name: str = Field(..., min_length=1, max_length=100)
    quota: int = Field(..., gt=0)
    sort_order: int = Field(default=0)
    #:'EMPLOYEE'(預設 — 員工自報票種)、'DEPENDENT'(代報眷屬池;每場次限 1 個)
    audience: str = Field(default="EMPLOYEE", pattern="^(EMPLOYEE|DEPENDENT)$")


class UpdateSessionRequest(BaseModel):
    """更新場次欄位(時間調整、提前關閉報名)。

    所有欄位皆可選,僅提供需更新的欄位。時間順序由 DB `chk_sessions_time_order`
    強制(註冊開放 < 註冊截止 < 抽籤 < 候補截止 < 場次開始 < 場次結束)。

    `status` 僅允許 admin 主動關閉報名(REGISTRATION_OPEN → REGISTRATION_CLOSED),
    其他狀態轉換由 lottery-runner / 排程任務驅動。
    """

    title: str | None = Field(default=None, min_length=1, max_length=200)
    venue: str | None = Field(default=None, min_length=1, max_length=200)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    registration_opens_at: datetime | None = None
    registration_closes_at: datetime | None = None
    lottery_at: datetime | None = None
    waitlist_close_at: datetime | None = None
    confirmation_deadline_hours: int | None = Field(default=None, ge=1, le=168)
    status: str | None = Field(default=None, pattern=r"^REGISTRATION_CLOSED$")


class CancelEventRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


# Response wrappers
