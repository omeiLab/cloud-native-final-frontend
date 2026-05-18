"""auth 模組 SQLAlchemy ORM(對齊 mig 0001 + 0008 + 0009/0010)

 改動:
- User.role CHECK 加 ADMIN_VIEWER + DEPENDENT(0009)
- User.email / employee_id 改 nullable(0009)— DEPENDENT 必為 NULL,其他 NOT NULL
  由 DB 0010 chk_users_role_invariant 條件式 CHECK 守
- Dependent 加 user_id FK → users.id(0009 nullable;0010 NOT NULL UNIQUE)
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
from sqlalchemy.dialects.postgresql import INET as PG_INET

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Any = Column(CHAR(26), primary_key=True)
    #:DEPENDENT 兩欄為 NULL;其他 role 仍 NOT NULL(由 DB chk_users_role_invariant 守)
    employee_id: Any = Column(String(20), nullable=True, unique=True)
    email: Any = Column(String(254), nullable=True, unique=True)
    name: Any = Column(String(100), nullable=False)
    department: Any = Column(String(100), nullable=True)
    job_grade: Any = Column(String(20), nullable=True)
    site: Any = Column(String(50), nullable=False)
    tenure_months: Any = Column(Integer, nullable=False, default=0)
    status: Any = Column(String(20), nullable=False, default="ACTIVE")
    role: Any = Column(String(20), nullable=False, default="EMPLOYEE")
    oidc_subject: Any = Column(String(255), nullable=True, unique=True)
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE', 'INACTIVE')", name="chk_users_status"),
        CheckConstraint(
            "role IN ('EMPLOYEE', 'ADMIN', 'ADMIN_VIEWER', 'VERIFIER', 'DEPENDENT')",
            name="chk_users_role",
        ),
        CheckConstraint("tenure_months >= 0", name="chk_users_tenure"),
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Any = Column(CHAR(26), primary_key=True)
    user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    token_hash: Any = Column(String(128), nullable=False, unique=True)
    issued_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    expires_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    revoked_at: Any = Column(TIMESTAMP(timezone=True), nullable=True)
    user_agent: Any = Column(String, nullable=True)
    ip_address: Any = Column(PG_INET, nullable=True)


class Dependent(Base):
    """員工眷屬()。

    眷屬同時是 dependents row 與 users row(共用 ULID — Dependent.id 等同 user_id):
    - users.role='DEPENDENT' / oidc_subject=NULL / email=NULL / employee_id=NULL
    - dependents.user_id = dependents.id(由 DependentRepository.create atomic INSERT 保證)
    報名時 reg.user_id 指向 dependent.user_id(代報語意);通知 fallback 員工 email。
    """

    __tablename__ = "dependents"

    id: Any = Column(CHAR(26), primary_key=True)
    employee_user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=False)
    # 新增:dependents.user_id FK 指向 users.id(共用 ULID,= dependents.id)
    user_id: Any = Column(CHAR(26), ForeignKey("users.id"), nullable=True, unique=True)
    name: Any = Column(String(100), nullable=False)
    relationship: Any = Column(String(20), nullable=False)
    identification: Any = Column(String(50), nullable=True)
    status: Any = Column(String(20), nullable=False, default="ACTIVE")
    created_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Any = Column(TIMESTAMP(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("employee_user_id", "name", name="uniq_dependents_employee_name"),
        CheckConstraint(
            "relationship IN ('SPOUSE', 'CHILD', 'PARENT', 'OTHER')",
            name="chk_dependents_relationship",
        ),
        CheckConstraint("status IN ('ACTIVE', 'INACTIVE')", name="chk_dependents_status"),
    )
