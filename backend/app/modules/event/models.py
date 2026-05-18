"""event 模組 SQLAlchemy ORM(對齊 mig 0002 + 0009)

 改動:
- Event 移除 v1 allow_dependents / max_dependents_per_employee(ORM 不映射;
  DB 0011 cleanup 才 DROP COLUMN)
- TicketType 加 audience(0009 已加)
"""

from typing import Any

from sqlalchemy import (
    CHAR,
    TIMESTAMP,
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY

from app.core.db import Base


class Event(Base):
    __tablename__ = "events"

    id: Any = Column(CHAR(26), primary_key=True)
    title: Any = Column(String(200), nullable=False)
    description: Any = Column(Text, nullable=True)
    cover_image_url: Any = Column(Text, nullable=True)
    status: Any = Column(String(20), nullable=False, default="DRAFT")
    allowed_sites: Any = Column(ARRAY(Text), nullable=False, default=list)
    #:廢除 allow_dependents/max_dependents_per_employee — ORM 不映射
    # DB 端欄位由 0011_cleanup 才 DROP;v2 code 不寫不讀
    created_by: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    cancelled_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('DRAFT', 'PUBLISHED', 'CANCELLED')", name="chk_events_status"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Any = Column(CHAR(26), primary_key=True)
    event_id: Any = Column(CHAR(26), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    title: Any = Column(String(200), nullable=False)
    venue: Any = Column(String(200), nullable=False)
    starts_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    ends_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    registration_opens_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    registration_closes_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    lottery_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    confirmation_deadline_hours: Any = Column(SmallInteger, nullable=False, default=48)
    waitlist_close_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    status: Any = Column(String(30), nullable=False, default="REGISTRATION_OPEN")
    lottery_executed_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LOTTERY_RUNNING', "
            "'LOTTERY_COMPLETED', 'FINALIZED', 'ONGOING', 'CLOSED')",
            name="chk_sessions_status",
        ),
        CheckConstraint(
            "registration_opens_at < registration_closes_at "
            "AND registration_closes_at <= lottery_at "
            "AND lottery_at < waitlist_close_at "
            "AND waitlist_close_at <= starts_at "
            "AND starts_at < ends_at",
            name="chk_sessions_time_order",
        ),
        CheckConstraint(
            "confirmation_deadline_hours BETWEEN 1 AND 168",
            name="chk_sessions_confirmation_hours",
        ),
    )


class TicketType(Base):
    """:加 audience 區分員工 / 眷屬池(0009)"""

    __tablename__ = "ticket_types"

    id: Any = Column(CHAR(26), primary_key=True)
    session_id: Any = Column(
        CHAR(26), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    name: Any = Column(String(100), nullable=False)
    quota: Any = Column(Integer, nullable=False)
    sort_order: Any = Column(SmallInteger, nullable=False, default=0)
    #:'EMPLOYEE'(預設)/ 'DEPENDENT'(代報眷屬池)
    audience: Any = Column(String(20), nullable=False, default="EMPLOYEE")
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("quota > 0", name="chk_ticket_types_quota"),
        CheckConstraint("audience IN ('EMPLOYEE', 'DEPENDENT')", name="chk_ticket_types_audience"),
    )
