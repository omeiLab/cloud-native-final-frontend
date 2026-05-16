"""跨模組共用 Ticket DTO(對齊設計 06 §13.2 + 10.6 +)

:reg/ticket 回 1:1。廢除 v1 的 TicketIssueResult / ticket_seq / holder_*。
 票券歸屬:
- EMPLOYEE 自報 → ticket.user_id = employee.id
- 員工代報眷屬 → ticket.user_id = dependent.user_id(對應 users.role='DEPENDENT')
- 票券 holder 顯示由 verify 時反查 user.name 取得
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.shared.enums import TicketStatus


class TicketDetail(BaseModel):
    """完整票券資訊;UI / admin 顯示 + audit"""

    model_config = ConfigDict(frozen=True)

    id: str
    registration_id: str
    user_id: str # 員工自報=員工 id;代報=眷屬 id(role=DEPENDENT)
    session_id: str
    status: TicketStatus
    issued_at: datetime
    used_at: datetime | None = None
    used_by_device: str | None = None
    revoked_at: datetime | None = None
    revoke_reason: str | None = None


class TicketSummary(BaseModel):
    """個人票夾用 — 不含撤銷理由等敏感欄位"""

    model_config = ConfigDict(frozen=True)

    id: str
    session_id: str
    status: TicketStatus
    issued_at: datetime
    used_at: datetime | None = None


class TicketWithQRPayload(BaseModel):
    """get_ticket_with_qr 回傳 — ticket 詳情 + 當下產的 QR JWT"""

    model_config = ConfigDict(frozen=True)

    ticket: TicketDetail
    qr_payload: str # JWT(EdDSA 簽,60 秒過期)
    qr_expires_at: datetime


class VerificationResult(BaseModel):
    """verify_and_use_ticket 成功時的回傳"""

    model_config = ConfigDict(frozen=True)

    ticket_id: str
    user_id: str
    session_id: str
    used_at: datetime
    user_name: str | None = None # 驗票員看 UI 用(若 user.role=DEPENDENT,顯示眷屬姓名)


class AttendanceStats(BaseModel):
    """場次入場統計(設計 06 §10.3 給 admin 用)"""

    model_config = ConfigDict(frozen=True)

    session_id: str
    issued: int
    used: int
    revoked: int
