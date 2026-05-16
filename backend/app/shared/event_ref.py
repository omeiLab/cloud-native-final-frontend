"""跨模組共用 Event / Session DTO — 對齊設計 06 §13.2 + """

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.shared.enums import EligibilityReason, EventStatus, SessionStatus


class TicketTypeInfo(BaseModel):
    """場次內票種資訊。:加 audience 欄位區分員工/眷屬池。"""

    model_config = ConfigDict(frozen=True)

    id: str
    session_id: str
    name: str
    quota: int
    sort_order: int = 0
    #:'EMPLOYEE' 給員工自報、'DEPENDENT' 給代報眷屬
    audience: str = "EMPLOYEE"


class SessionInfo(BaseModel):
    """場次基本資訊(供跨模組查詢用,不含敏感資料)"""

    model_config = ConfigDict(frozen=True)

    id: str
    event_id: str
    title: str
    venue: str
    starts_at: datetime
    ends_at: datetime
    registration_opens_at: datetime
    registration_closes_at: datetime
    lottery_at: datetime
    waitlist_close_at: datetime
    confirmation_deadline_hours: int
    status: SessionStatus
    lottery_executed_at: datetime | None
    allowed_sites: list[str] = Field(default_factory=list)
    ticket_types: list[TicketTypeInfo] = Field(default_factory=list)


class EventDetail(BaseModel):
    """活動詳情(含所有場次)。

    :廢除 v1 的 allow_dependents/max_dependents_per_employee(改由
    ticket_types.audience 區分;DB 欄位 0011 後 DROP)。
    """

    model_config = ConfigDict(frozen=True)

    id: str
    title: str
    description: str | None = None
    cover_image_url: str | None = None
    status: EventStatus
    allowed_sites: list[str] = Field(default_factory=list)
    created_by: str
    created_at: datetime
    updated_at: datetime
    cancelled_at: datetime | None = None
    sessions: list[SessionInfo] = Field(default_factory=list)


class EventSummary(BaseModel):
    """活動列表用簡略資訊(不含 sessions 細節,只標 site / 時間)"""

    model_config = ConfigDict(frozen=True)

    id: str
    title: str
    cover_image_url: str | None = None
    status: EventStatus
    allowed_sites: list[str] = Field(default_factory=list)
    starts_at: datetime | None = None
    venue: str | None = None
    remaining_quota: int = 0
    session_count: int = 0
    # 員工查詢時依其 site 計算;allowed_sites=[] 視同全廠區可參加
    is_eligible: bool = True


class EligibilityResult(BaseModel):
    """資格檢查結果。reason_code 為結構化錯因,reason 是給 user 看的中文訊息"""

    model_config = ConfigDict(frozen=True)

    eligible: bool
    reason: str | None = None
    reason_code: EligibilityReason | None = None
    user_site: str
    allowed_sites: list[str] = Field(default_factory=list)
    session_status: SessionStatus | None = None
