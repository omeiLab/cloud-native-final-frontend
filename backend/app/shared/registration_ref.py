"""跨模組共用 Registration DTO — 對齊設計 06 §13.2 + 

 改動:廢除 v1 的 dependent_count / dependent_snapshot / DependentSnapshotItem
(reg/ticket 回 1:1)。改用 as_dependent_id 標記「該 reg 是員工為哪位眷屬代報的」。
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.shared.enums import RegistrationStatus


class RegistrationRef(BaseModel):
    """輕量 ref:lottery / ticket / admin 跨模組查詢用,不含時間戳"""

    model_config = ConfigDict(frozen=True)

    id: str
    user_id: str
    session_id: str
    ticket_type_id: str
    status: RegistrationStatus
    lottery_rank: int | None = None
    waitlist_position: int | None = None


class RegistrationDetail(BaseModel):
    """完整詳情:UI / admin 顯示 + audit。

    :`as_dependent_id` 標記該 reg 是員工為哪位眷屬代報的。員工自報時 NULL。
    UI 用 `as_dependent_id` 配合 dependent.name 顯示『為眷屬 X 報名』。
    """

    model_config = ConfigDict(frozen=True)

    id: str
    user_id: str # 員工自報=員工 id;代報=眷屬 id(role=DEPENDENT)
    session_id: str
    ticket_type_id: str
    status: RegistrationStatus
    lottery_rank: int | None = None
    waitlist_position: int | None = None
    confirmation_deadline: datetime | None = None
    confirmed_at: datetime | None = None
    forfeited_at: datetime | None = None
    cancelled_at: datetime | None = None
    # 新增:該 reg 對應的 dependent.id(若是代報);員工自報=NULL
    as_dependent_id: str | None = None
    created_at: datetime
    updated_at: datetime


class StatusCount(BaseModel):
    """每場次每狀態的人數統計(lottery / admin 用)"""

    model_config = ConfigDict(frozen=True)

    session_id: str
    ticket_type_id: str
    counts: dict[str, int] = Field(default_factory=dict)
