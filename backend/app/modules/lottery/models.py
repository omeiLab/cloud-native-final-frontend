"""lottery 模組 SQLAlchemy ORM(對齊 mig 005 + 0009 + 設計 04 §4.8)

 改動:
- ALGORITHM_VERSION bump 為 "fisher-yates-v2-independent"(-12)
- LotteryRecord 加 status / quota_at_draw / emp_remaining_allocated 欄位(-25/27)
"""

from typing import Any

from sqlalchemy import (
    CHAR,
    TIMESTAMP,
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from app.core.db import Base

#:bump 演算法版本,replay 時依版本分流(舊 v1 records 不能用 v2 規則 replay)
ALGORITHM_VERSION = "fisher-yates-v2-independent"


class LotteryRecord(Base):
    __tablename__ = "lottery_records"

    id: Any = Column(CHAR(26), primary_key=True)
    session_id: Any = Column(CHAR(26), ForeignKey("sessions.id"), nullable=False)
    ticket_type_id: Any = Column(CHAR(26), ForeignKey("ticket_types.id"), nullable=False)
    seed: Any = Column(String(64), nullable=False)
    candidate_count: Any = Column(Integer, nullable=False)
    winner_count: Any = Column(Integer, nullable=False)
    waitlist_count: Any = Column(Integer, nullable=False)
    algorithm_version: Any = Column(String(50), nullable=False, default=ALGORITHM_VERSION)
    #:RUNNING / COMPLETED — 防半成品 race
    status: Any = Column(String(20), nullable=False, default="COMPLETED")
    #:抽籤當下凍結 quota,避免 admin 改 ticket_types.quota 影響 emp_remaining
    quota_at_draw: Any = Column(Integer, nullable=False, default=0)
    #:DEP audience 抽籤時記下「拿到的員工剩餘配額」給 audit replay 用
    emp_remaining_allocated: Any = Column(Integer, nullable=False, default=0)
    executed_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    duration_ms: Any = Column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "ticket_type_id",
            name="uniq_lottery_records_session_ticket_type",
        ),
        CheckConstraint(
            "candidate_count >= 0 "
            "AND winner_count >= 0 "
            "AND waitlist_count >= 0 "
            "AND winner_count + waitlist_count <= candidate_count",
            name="chk_lottery_records_counts",
        ),
        CheckConstraint("status IN ('RUNNING', 'COMPLETED')", name="chk_lottery_records_status"),
    )
