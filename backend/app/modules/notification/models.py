"""notification 模組 SQLAlchemy ORM(對齊 mig 007 + 設計 04 §4.7)"""

from typing import Any

from sqlalchemy import (
    CHAR,
    TIMESTAMP,
    CheckConstraint,
    Column,
    ForeignKey,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.core.db import Base


class Notification(Base):
    """:加 subject_user_id 欄位(-9)— 紀錄通知主體(若是員工代眷屬中籤,
    user_id=員工 inbox,subject_user_id=眷屬 user.id)。"""

    __tablename__ = "notifications"

    id: Any = Column(CHAR(26), primary_key=True)
    #:user_id 仍是「投遞 inbox 的對象」(收件人),保留原語意
    user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    # 新增:通知主體(若 != user_id 表示員工為眷屬代收;通常是 DEPENDENT user.id)
    subject_user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=True)
    channel: Any = Column(String(20), nullable=False)
    type: Any = Column(String(50), nullable=False)
    title: Any = Column(String(200), nullable=False)
    body: Any = Column(Text, nullable=False)
    payload: Any = Column(JSONB, nullable=False, default=dict)
    status: Any = Column(String(20), nullable=False, default="PENDING")
    retry_count: Any = Column(SmallInteger, nullable=False, default=0)
    last_error: Any = Column(Text, nullable=True)
    sent_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    read_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "channel IN ('EMAIL', 'IN_APP', 'WEBSOCKET')",
            name="chk_notifications_channel",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')",
            name="chk_notifications_status",
        ),
        CheckConstraint(
            "retry_count >= 0 AND retry_count <= 5",
            name="chk_notifications_retry",
        ),
    )
