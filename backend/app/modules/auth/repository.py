"""auth 模組 repository — 只此模組可直接存取 users / refresh_tokens / dependents 表

 改動:
- DependentRepository.create:atomic INSERT users + dependents 共用 ULID(-8 begin_nested)
- DependentRepository.soft_delete_owned:同步 UPDATE users.status='INACTIVE'
- DependentRepository.list_with_user_ids:支援 include_inactive(-7 歷史 ownership)
- DependentRepository.get_by_user_id:讓 notification fallback 反查員工 email
- UserRepository.count_active_employees_by_sites:改名 + 排除 DEPENDENT(-17)
- DependentRepository.count_active_by_employee:應用層 cap 用(-35)
"""

import hashlib

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.core.ulid import generate_ulid
from app.modules.auth.errors import DependentAlreadyExistsError
from app.modules.auth.models import Dependent, RefreshToken, User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, user_id: str) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_many_by_ids(self, user_ids: list[str]) -> list[User]:
        """批次取使用者(admin 列表用 — 設計 06 §12.4 get_users_batch)"""
        if not user_ids:
            return []
        result = await self.session.execute(select(User).where(User.id.in_(user_ids)))
        return list(result.scalars().all())

    async def count_active_employees_by_sites(self, sites: list[str]) -> dict[str, int]:
        """每個 site 的 ACTIVE 員工數(排除 DEPENDENT)。

        :改名 + 排除 DEPENDENT(-17)— 對齊「廠區員工數預覽」原語意,
        眷屬不算入廠區人數。
        """
        if not sites:
            return {}
        result = await self.session.execute(
            select(User.site, func.count(User.id))
            .where(User.site.in_(sites))
            .where(User.status == "ACTIVE")
            .where(User.role != "DEPENDENT")
            .group_by(User.site)
        )
        out: dict[str, int] = dict.fromkeys(sites, 0)
        for site, count in result.all():
            out[str(site)] = int(count)
        return out

    async def get_by_oidc_subject(self, oidc_subject: str) -> User | None:
        result = await self.session.execute(select(User).where(User.oidc_subject == oidc_subject))
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def upsert_from_oidc(
        self,
        *,
        oidc_subject: str,
        employee_id: str,
        email: str,
        name: str,
        department: str | None,
        job_grade: str | None,
        site: str,
        role: str,
    ) -> User:
        """OIDC 登入時:已存在則更新姓名/部門/職等(IdP 端可能變),不存在則建。

        :OIDC 簽發限定 EMPLOYEE/ADMIN/ADMIN_VIEWER/VERIFIER,DEPENDENT 不會
        走此路徑(由 _issue_token_pair guard 攔截)。
        """
        existing = await self.get_by_oidc_subject(oidc_subject)
        now = now_utc()
        if existing:
            existing.name = name
            existing.email = email
            existing.department = department
            existing.job_grade = job_grade
            existing.site = site
            existing.role = role
            existing.updated_at = now
            await self.session.flush()
            return existing
        user = User(
            id=generate_ulid(),
            employee_id=employee_id,
            email=email,
            name=name,
            department=department,
            job_grade=job_grade,
            site=site,
            role=role,
            oidc_subject=oidc_subject,
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        await self.session.flush()
        return user


class RefreshTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def create(
        self,
        *,
        user_id: str,
        raw_token: str,
        ttl_seconds: int,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> RefreshToken:
        from datetime import timedelta

        now = now_utc()
        rt = RefreshToken(
            id=generate_ulid(),
            user_id=user_id,
            token_hash=self.hash_token(raw_token),
            issued_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
            user_agent=user_agent,
            ip_address=ip_address,
        )
        self.session.add(rt)
        await self.session.flush()
        return rt

    async def find_active_by_raw(self, raw_token: str) -> RefreshToken | None:
        token_hash = self.hash_token(raw_token)
        result = await self.session.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now_utc(),
            )
        )
        return result.scalar_one_or_none()

    async def find_any_by_raw(self, raw_token: str) -> RefreshToken | None:
        """不論 revoke / expire,只要 hash 相符就回傳;偵測 reuse 用"""
        token_hash = self.hash_token(raw_token)
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def revoke(self, refresh_token_id: str) -> int:
        """conditional revoke:WHERE id=? AND revoked_at IS NULL。

        race-condition 防護:同一個 refresh token 被兩個並行
        request 同時拿來 refresh,find_active_by_raw 都會讀到 active row(寫操作
        還沒 commit),沒有 conditional 兩個都會成功 UPDATE → 兩組新 token pair
        都 issue → token cloning。

        加 `revoked_at IS NULL` 條件 + rowcount 檢查 → 只能成功一次,後到的
        rowcount=0,caller 應視為 race / reuse 並走 family revocation。
        """
        result = await self.session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.id == refresh_token_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now_utc())
        )
        return int(getattr(result, "rowcount", 0) or 0)

    async def revoke_all_for_user(self, user_id: str) -> int:
        result = await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now_utc())
        )
        return int(getattr(result, "rowcount", 0) or 0)


# 應用層 dependent 上限(-35)— 配合 DB trigger 雙保險
MAX_DEPENDENTS_PER_EMPLOYEE = 10


class DependentRepository:
    """員工眷屬 CRUD()。

    :每個 dependent 對應一筆 users row(role='DEPENDENT',共用 ULID)。
    create/soft_delete 跨 users + dependents,在 begin_nested savepoint 內 atomic。
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        employee_user_id: str,
        name: str,
        relationship: str,
        identification: str | None,
    ) -> Dependent:
        """atomic INSERT users + dependents(-8 begin_nested)。

        IntegrityError(uniq_dependents_employee_name 撞)→ savepoint rollback,
        外層 transaction 不受影響。
        """
        # 應用層 cap 上限(-35)
        active_count = await self.count_active_by_employee(employee_user_id)
        if active_count >= MAX_DEPENDENTS_PER_EMPLOYEE:
            raise DependentAlreadyExistsError(f"每位員工最多 {MAX_DEPENDENTS_PER_EMPLOYEE} 位眷屬")

        # 取員工 site(眷屬繼承)
        emp_result = await self.session.execute(select(User).where(User.id == employee_user_id))
        emp_user = emp_result.scalar_one()

        shared_id = generate_ulid()
        now = now_utc()

        # SAVEPOINT 包住兩個 INSERT — IntegrityError 後自動 rollback
        async with self.session.begin_nested():
            try:
                user_rec = User(
                    id=shared_id,
                    employee_id=None,
                    email=None,
                    name=name,
                    department=None,
                    job_grade=None,
                    site=emp_user.site,
                    role="DEPENDENT",
                    status="ACTIVE",
                    oidc_subject=None,
                    created_at=now,
                    updated_at=now,
                )
                self.session.add(user_rec)
                await self.session.flush()

                dep = Dependent(
                    id=shared_id,
                    employee_user_id=employee_user_id,
                    user_id=shared_id,
                    name=name,
                    relationship=relationship,
                    identification=identification,
                    status="ACTIVE",
                    created_at=now,
                    updated_at=now,
                )
                self.session.add(dep)
                await self.session.flush()
            except IntegrityError as e:
                raise DependentAlreadyExistsError(f"已存在同名眷屬({name})") from e
        return dep

    async def count_active_by_employee(self, employee_user_id: str) -> int:
        """應用層 dependent 上限 cap 用(-35)"""
        result = await self.session.execute(
            select(func.count(Dependent.id))
            .where(Dependent.employee_user_id == employee_user_id)
            .where(Dependent.status == "ACTIVE")
        )
        return int(result.scalar_one())

    async def list_by_employee(
        self, employee_user_id: str, *, include_inactive: bool = False
    ) -> list[Dependent]:
        """:支援 include_inactive(-7)。

        - False(預設):只 ACTIVE,給「新增報名」用 — 不能用 INACTIVE 眷屬
        - True:含 INACTIVE,給「歷史 reg/ticket ownership / list_my_registrations」用 —
          員工刪除眷屬後仍能看到歷史報名
        """
        stmt = select(Dependent).where(Dependent.employee_user_id == employee_user_id)
        if not include_inactive:
            stmt = stmt.where(Dependent.status == "ACTIVE")
        stmt = stmt.order_by(Dependent.created_at.asc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, dependent_id: str) -> Dependent | None:
        result = await self.session.execute(select(Dependent).where(Dependent.id == dependent_id))
        return result.scalar_one_or_none()

    async def get_by_user_id(self, user_id: str) -> Dependent | None:
        """:用 dependents.user_id 反查(notification fallback 員工 email)"""
        result = await self.session.execute(select(Dependent).where(Dependent.user_id == user_id))
        return result.scalar_one_or_none()

    async def get_many_by_ids_owned(
        self, dependent_ids: list[str], employee_user_id: str
    ) -> list[Dependent]:
        """報名時批次驗 ownership(僅 ACTIVE,因報名是新動作)"""
        if not dependent_ids:
            return []
        result = await self.session.execute(
            select(Dependent)
            .where(Dependent.id.in_(dependent_ids))
            .where(Dependent.employee_user_id == employee_user_id)
            .where(Dependent.status == "ACTIVE")
        )
        return list(result.scalars().all())

    async def soft_delete_owned(self, dependent_id: str, employee_user_id: str) -> bool:
        """:同步 UPDATE users.status='INACTIVE' + dependents.status='INACTIVE'。
        savepoint 內 atomic。
        """
        async with self.session.begin_nested():
            result = await self.session.execute(
                update(Dependent)
                .where(Dependent.id == dependent_id)
                .where(Dependent.employee_user_id == employee_user_id)
                .where(Dependent.status == "ACTIVE")
                .values(status="INACTIVE", updated_at=now_utc())
            )
            row_count = int(getattr(result, "rowcount", 0) or 0)
            if row_count != 1:
                return False
            # 同步 users(共用 ULID)
            await self.session.execute(
                update(User)
                .where(User.id == dependent_id)
                .values(status="INACTIVE", updated_at=now_utc())
            )
        return True
