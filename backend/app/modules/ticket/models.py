"""ticket 模組 SQLAlchemy ORM(對齊 mig 006 + mig 008,0011 cleanup pending)

 眷屬:廢除舊 1:1 約束,改 1:N(主票 ticket_seq=0 + 眷屬票 seq=1..N)。

⚠️ 0011_cleanup_phase10v2 預設 no-op(env-guarded),目前線上仍保留 v1 schema:
   ticket_seq / holder_name / holder_relationship / chk_tickets_holder_consistency
   / uniq_tickets_registration_seq。
ORM 此檔反映「線上實際 schema」(對齊),不是 設計目標(reg/ticket 1:1)。
等 DBA burn-in 7-14 天後跑 ALLOW_PHASE10_CLEANUP=1 alembic upgrade head 真執行
0011,**此檔需同步** drop ticket_seq / holder_* 並改回 uniq_tickets_registration。
具體 cleanup checklist 見 design_doc/audit-.md §4 後續。
"""

from typing import Any

from sqlalchemy import (
    CHAR,
    TIMESTAMP,
    CheckConstraint,
    Column,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
)

from app.core.db import Base


class Ticket(Base):
    __tablename__ = "tickets"

    id: Any = Column(CHAR(26), primary_key=True)
    registration_id: Any = Column(CHAR(26), ForeignKey("registrations.id"), nullable=False)
    user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    session_id: Any = Column(CHAR(26), ForeignKey("sessions.id"), nullable=False)
    status: Any = Column(String(20), nullable=False, default="ISSUED")
    #:同 registration 內的票券序號(0=員工主票,1+=眷屬票)
    ticket_seq: Any = Column(SmallInteger, nullable=False, default=0)
    holder_name: Any = Column(String(100), nullable=True)
    holder_relationship: Any = Column(String(20), nullable=True)
    issued_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    used_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    used_by_device: Any = Column(String(100), nullable=True)
    revoked_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    revoke_reason: Any = Column(String(200), nullable=True)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("registration_id", "ticket_seq", name="uniq_tickets_registration_seq"),
        CheckConstraint(
            "status IN ('ISSUED', 'USED', 'REVOKED')",
            name="chk_tickets_status",
        ),
        CheckConstraint("ticket_seq >= 0", name="chk_tickets_seq_nonneg"),
        CheckConstraint(
            "(ticket_seq = 0 AND holder_name IS NULL AND holder_relationship IS NULL) "
            "OR (ticket_seq >= 1 AND holder_name IS NOT NULL "
            "AND holder_relationship IS NOT NULL)",
            name="chk_tickets_holder_consistency",
        ),
    )
