"""registration 模組 SQLAlchemy ORM(對齊 mig 003 + 設計 04 §4.5)"""

from typing import Any

from sqlalchemy import (
    CHAR,
    TIMESTAMP,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.core.db import Base


class Registration(Base):
    __tablename__ = "registrations"

    id: Any = Column(CHAR(26), primary_key=True)
    user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    session_id: Any = Column(CHAR(26), ForeignKey("sessions.id"), nullable=False)
    ticket_type_id: Any = Column(CHAR(26), ForeignKey("ticket_types.id"), nullable=False)
    status: Any = Column(String(20), nullable=False, default="REGISTERED")
    lottery_rank: Any = Column(Integer, nullable=True)
    waitlist_position: Any = Column(Integer, nullable=True)
    confirmation_deadline: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    confirmed_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    forfeited_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    cancelled_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    # 眷屬:報名時帶 N 位眷屬;ticket 發 1 + dependent_count 張
    dependent_count: Any = Column(SmallInteger, nullable=False, default=0)
    dependent_snapshot: Any = Column(JSONB, nullable=False, default=list)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        # BR-01:同員工同場次只能 1 筆 *active* 報名(非 CANCELLED)。
        # 0012_reg_partial_uniq 把 table-level UNIQUE 改成 partial unique INDEX
        # WHERE status <> 'CANCELLED',讓 CANCELLED 不擋同場次再報(訴求 2)。
        # ORM 同步用 Index(...postgresql_where=text(...))。
        Index(
            "uniq_registrations_user_session_active",
            "user_id",
            "session_id",
            unique=True,
            postgresql_where=text("status <> 'CANCELLED'"),
        ),
        CheckConstraint(
            "status IN ("
            "'REGISTERED', 'CANCELLED', 'IN_LOTTERY',"
            "'WON', 'LOST', 'WAITLISTED',"
            "'CONFIRMED', 'FORFEITED', 'EXPIRED', 'USED'"
            ")",
            name="chk_registrations_status",
        ),
        CheckConstraint("dependent_count >= 0", name="chk_registrations_dependent_count_nonneg"),
    )
