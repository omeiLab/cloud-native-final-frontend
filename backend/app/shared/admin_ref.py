"""跨模組共用 Admin DTO(對齊設計 05 §13 + 06 §12)"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class TimelinePoint(BaseModel):
    """報名時間軸 datapoint"""

    model_config = ConfigDict(frozen=True)

    date: date
    count: int


class SiteCount(BaseModel):
    model_config = ConfigDict(frozen=True)

    site: str
    count: int


class TicketTypeProgress(BaseModel):
    """單一票種統計(設計 05 §13.7)"""

    model_config = ConfigDict(frozen=True)

    ticket_type_id: str
    name: str
    quota: int
    registered: int
    won: int
    confirmed: int


class LotteryStatusInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    executed: bool
    lottery_at: datetime | None = None


class AttendanceSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    checked_in: int
    total_confirmed: int


class DashboardData(BaseModel):
    """活動儀表板聚合(設計 05 §13.7)"""

    model_config = ConfigDict(frozen=True)

    event_id: str
    registration_timeline: list[TimelinePoint]
    site_distribution: list[SiteCount]
    ticket_type_progress: list[TicketTypeProgress]
    lottery_status: LotteryStatusInfo
    attendance: AttendanceSummary


class RegistrationUserView(BaseModel):
    """admin 報名清單內的使用者欄位(已 PII mask)"""

    model_config = ConfigDict(frozen=True)

    employee_id: str
    name: str
    department: str | None = None
    site: str


class RegistrationWithUser(BaseModel):
    """admin 報名清單 item(設計 05 §13.6)"""

    model_config = ConfigDict(frozen=True)

    id: str
    user: RegistrationUserView
    session_title: str
    ticket_type_name: str
    status: str
    lottery_rank: int | None = None
    created_at: datetime


class SiteEmployeeCount(BaseModel):
    """廠區員工數預覽(設計 05 §13.5)"""

    model_config = ConfigDict(frozen=True)

    sites: dict[str, int]
    total: int


class ExportTaskCreated(BaseModel):
    """ Batch B(A6):背景化 export enqueue 後回 task_id"""

    model_config = ConfigDict(frozen=True)

    task_id: str
    status: str # 永遠 PENDING
    poll_url: str # 給前端 GET 查狀態的 URL


class ExportTaskStatus(BaseModel):
    """ Batch B(A6):export task 狀態查詢回應"""

    model_config = ConfigDict(frozen=True)

    task_id: str
    event_id: str
    format: str # csv / xlsx
    status: str # PENDING / RUNNING / SUCCEEDED / FAILED
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    download_url: str | None = None # SUCCEEDED 才填
