"""稽核日誌(BR-09)— Service 層手動呼叫 audit() 紀錄狀態變更"""

from typing import Any

from sqlalchemy import CHAR, JSON, TIMESTAMP, Column, String
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import Base
from app.core.logging import get_logger
from app.core.time import now_utc
from app.core.ulid import generate_ulid

logger = get_logger(__name__)


class AuditLog(Base):
    """audit_logs 表 ORM(對齊 §6.4)"""

    __tablename__ = "audit_logs"

    id: Any = Column(CHAR(26), primary_key=True)
    actor_id: Any = Column(CHAR(26), nullable=True, index=True)
    actor_role: Any = Column(String(20), nullable=True)
    action: Any = Column(String(50), nullable=False, index=True)
    entity_type: Any = Column(String(50), nullable=False, index=True)
    entity_id: Any = Column(CHAR(26), nullable=False, index=True)
    before: Any = Column(JSON, nullable=True)
    after: Any = Column(JSON, nullable=True)
    ip_address: Any = Column(INET, nullable=True)
    user_agent: Any = Column(String, nullable=True)
    request_id: Any = Column(CHAR(36), nullable=True)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False, default=now_utc)


async def audit(
    session: AsyncSession,
    *,
    actor_id: str | None,
    actor_role: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """寫一筆 audit log。需要傳入 session(同 transaction);呼叫者負責 commit"""
    log = AuditLog(
        id=generate_ulid(),
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
        created_at=now_utc(),
    )
    session.add(log)
    logger.debug(
        "audit_recorded",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
    )
