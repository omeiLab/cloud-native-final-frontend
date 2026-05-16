"""auth 模組 Service — OIDC 登入 + JWT 簽發 + Refresh + 登出 + audit"""

import json
import secrets
from typing import Any, Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.core.redis import add_jwt_to_denylist, get_redis
from app.core.security import (
    decode_and_verify_token,
    encode_access_token,
    jwt_remaining_ttl,
)
from app.modules.auth.errors import (
    DependentNotFoundError,
    InvalidStateError,
    OIDCExchangeError,
    RefreshTokenInvalidError,
    UnauthenticatedError,
)
from app.modules.auth.models import User
from app.modules.auth.oidc import (
    build_authorize_url,
    exchange_code_for_claims,
    generate_nonce,
    generate_pkce_pair,
    generate_state,
)
from app.modules.auth.repository import (
    DependentRepository,
    RefreshTokenRepository,
    UserRepository,
)
from app.modules.auth.schemas import DependentResponse, TokenPair
from app.shared.dependent_ref import DependentRef
from app.shared.enums import DependentRelationship, DependentStatus
from app.shared.user_ref import UserDetail

logger = get_logger(__name__)

# Redis key prefix
_OIDC_STATE_KEY = "oidc:state:{state}"
_OIDC_STATE_TTL_SECONDS = 300


@runtime_checkable
class AuthServiceProtocol(Protocol):
    """跨模組呼叫介面 — 限定其他模組只能讀使用者基本資訊。

     notification 注入此 Protocol(取 email / display_name 渲染範本);
     admin 也走此介面。簽發 token / OIDC 流程不在 Protocol 內,只 auth 自己用。
    """

    async def get_user_by_id(self, user_id: str) -> "UserDetail | None":...

    async def get_users_batch(self, user_ids: list[str]) -> "list[UserDetail]":
        """批次取使用者(設計 06 §12.4 admin 列表用,避免 N+1)"""
        ...

    async def count_active_employees_by_sites(self, sites: list[str]) -> dict[str, int]:
        """各廠區 ACTIVE 員工數(:排除 DEPENDENT)"""
        ...

    async def list_dependents(
        self, employee_user_id: str, *, include_inactive: bool = False
    ) -> "list[DependentRef]":
        """:include_inactive=True 給歷史 ownership(-7)"""
        ...

    async def get_dependents_owned(
        self, dependent_ids: list[str], employee_user_id: str
    ) -> "list[DependentRef]":
        """報名時驗證 dependent_ids 屬該員工 + ACTIVE"""
        ...

    async def get_dependent_by_user_id(self, user_id: str) -> "DependentRef | None":
        """:notification fallback / registration ownership 反查"""
        ...

    async def get_employee_for_dependent(self, dependent_id: str) -> "UserDetail | None":
        """:給 notification 反查員工 inbox 用(避免直接 import auth.models)"""
        ...


class AuthService:
    """auth 模組對外 service。其他模組透過 AuthServiceProtocol 注入。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.user_repo = UserRepository(session)
        self.refresh_repo = RefreshTokenRepository(session)
        self.dependent_repo = DependentRepository(session)

    # OIDC flow

    async def build_authorize_url(self, redirect_uri: str | None = None) -> tuple[str, str]:
        """產 state + nonce + PKCE,Redis 存 5 分鐘,回傳 IdP authorize URL。

        redirect_uri:
        - None → 用 settings.auth0_callback_url(production 預設)
        - 非 None → 必須在 `auth0_allowed_callback_urls` 白名單內,否則 InvalidStateError
        - 同一個 redirect_uri 也會跟 nonce/code_verifier 一起存進 Redis state,
          callback 階段 token exchange 需用相同值(OAuth2 規定)。
        """
        if redirect_uri is not None:
            allowed = {
                u.strip() for u in settings.auth0_allowed_callback_urls.split(",") if u.strip()
            }
            if redirect_uri not in allowed:
                raise InvalidStateError(f"redirect_uri 不在白名單內(allowed: {sorted(allowed)})")

        state = generate_state()
        nonce = generate_nonce()
        code_verifier, code_challenge = generate_pkce_pair()
        redis = get_redis()
        payload = json.dumps(
            {
                "nonce": nonce,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri, # None 時 callback 階段 fallback config
            }
        )
        await redis.set(_OIDC_STATE_KEY.format(state=state), payload, ex=_OIDC_STATE_TTL_SECONDS)
        url = await build_authorize_url(state, nonce, code_challenge, redirect_uri=redirect_uri)
        return url, state

    async def oidc_callback(
        self,
        code: str,
        state: str,
        *,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> TokenPair:
        """callback:驗 state → 取 nonce/verifier → 驗 id_token → 同步 user → 簽 JWT"""
        # 1. 取 state 對應的 nonce + code_verifier(同時做 CSRF state 驗證)
        redis = get_redis()
        state_key = _OIDC_STATE_KEY.format(state=state)
        raw = await redis.get(state_key)
        if not raw:
            raise InvalidStateError("state 無效或過期")
        await redis.delete(state_key)
        try:
            state_data = json.loads(raw)
            nonce = state_data["nonce"]
            code_verifier = state_data["code_verifier"]
            # 動態 redirect_uri:state 階段存的 redirect_uri 在 token
            # exchange 必須完全一致(OAuth2 規範),用.get 兼容舊 state(deploy 過渡期)
            state_redirect_uri = state_data.get("redirect_uri")
        except (json.JSONDecodeError, KeyError) as e:
            raise InvalidStateError("state payload 格式錯誤") from e

        # 2. 換 id_token claims(驗簽 + iss/aud/exp/nonce)
        claims = await exchange_code_for_claims(
            code,
            code_verifier=code_verifier,
            nonce=nonce,
            redirect_uri=state_redirect_uri,
        )
        oidc_subject = claims.get("sub")
        if not oidc_subject:
            raise OIDCExchangeError("OIDC claims 缺 sub")

        # 3. 從 id_token claims 萃取員工資訊(Auth0 namespaced custom claims)
        employee_id = claims.get("employee_id") or claims.get("sub", "").replace("|", "-")[:20]
        site = claims.get("site") or claims.get("https://cets.alanh.uk/site") or "HSINCHU"
        # role 預設 EMPLOYEE;ADMIN/SUPER_ADMIN 由 DB seed 控制(BR 安全要求)
        # 既有用戶以 DB 為準,新用戶一律 EMPLOYEE
        oidc_role = claims.get("role") or claims.get("https://cets.alanh.uk/role") or "EMPLOYEE"
        email = claims.get("email", "")
        name = claims.get("name") or claims.get("nickname") or email
        department = claims.get("department") or claims.get("https://cets.alanh.uk/department")
        job_grade = claims.get("job_grade") or claims.get("https://cets.alanh.uk/job_grade")

        # 4. upsert(role 由 repository 層保護:既有用戶不被 OIDC 覆蓋)
        existing = await self.user_repo.get_by_oidc_subject(oidc_subject)
        effective_role = existing.role if existing else "EMPLOYEE"
        if existing and oidc_role != existing.role:
            logger.info(
                "oidc_role_claim_ignored",
                oidc_role=oidc_role,
                db_role=existing.role,
                user_id=existing.id,
            )
        user = await self.user_repo.upsert_from_oidc(
            oidc_subject=oidc_subject,
            employee_id=employee_id,
            email=email,
            name=name,
            department=department,
            job_grade=job_grade,
            site=site,
            role=effective_role,
        )

        # 5. 簽發 access token + refresh token
        token_pair = await self._issue_token_pair(
            user, ip_address=ip_address, user_agent=user_agent
        )

        # 6. audit
        await audit(
            self.session,
            actor_id=user.id,
            actor_role=user.role,
            action="auth.login",
            entity_type="user",
            entity_id=user.id,
            after={"oidc_subject": oidc_subject, "role": user.role, "site": user.site},
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        await self.session.commit()
        logger.info("oidc_login_success", user_id=user.id, site=user.site, role=user.role)
        return token_pair

    # Refresh / Logout

    async def refresh(
        self,
        refresh_token: str,
        *,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> TokenPair:
        """以 refresh token 換新 pair。

        防護層次:
        1. Rate limit per-IP():防暴力枚舉 / 失竊 token 重放洪水。
        2. Reuse detection:若 hash 相符但已 revoked → 視為 token replay 攻擊,
           把該 user 全家(family)refresh 都吊銷,登出所有 session。
        3. Race protection():同一 token 並行兩次 refresh 只能成功一次,
           輸的一方 rowcount=0 觸發 family revocation(避免 token cloning)。
        """
        # ─ 1. Rate limit per-IP(防暴力)─
        # 沒 IP(內部呼叫 / proxy 漏 X-Forwarded-For)時 fallback 到 "unknown"
        # — 共用桶相對寬,但仍會擋掉攻擊集中流量。
        await check_rate_limit(
            key=f"refresh:ip:{ip_address or 'unknown'}",
            limit=settings.auth_refresh_rate_per_minute_per_ip,
            window_seconds=60,
        )

        rt = await self.refresh_repo.find_active_by_raw(refresh_token)
        if rt is None:
            # 是不存在還是已 revoked?
            suspect = await self.refresh_repo.find_any_by_raw(refresh_token)
            if suspect is not None and suspect.revoked_at is not None:
                # 已 revoke 卻被 reuse → family revocation
                count = await self.refresh_repo.revoke_all_for_user(suspect.user_id)
                await audit(
                    self.session,
                    actor_id=suspect.user_id,
                    actor_role=None,
                    action="auth.refresh_reuse_detected",
                    entity_type="user",
                    entity_id=suspect.user_id,
                    after={"family_revoked_count": count},
                    request_id=request_id,
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
                await self.session.commit()
                logger.warning(
                    "refresh_token_reuse_family_revoked",
                    user_id=suspect.user_id,
                    revoked=count,
                )
            raise RefreshTokenInvalidError("Refresh token 無效或已撤銷")

        user = await self.user_repo.get_by_id(rt.user_id)
        if user is None:
            raise RefreshTokenInvalidError("使用者不存在")

        # ─ 3. Race-protected rotate()─
        # conditional UPDATE WHERE id=? AND revoked_at IS NULL,只能成功一次。
        # rowcount=0 表示同一 token 已被另一個並行 request 換掉 — 視為竊取後
        # cloning,走 family revocation。
        revoked = await self.refresh_repo.revoke(rt.id)
        if revoked == 0:
            count = await self.refresh_repo.revoke_all_for_user(rt.user_id)
            await audit(
                self.session,
                actor_id=rt.user_id,
                actor_role=user.role,
                action="auth.refresh_race_detected",
                entity_type="user",
                entity_id=rt.user_id,
                after={"family_revoked_count": count},
                request_id=request_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await self.session.commit()
            logger.warning(
                "refresh_token_race_family_revoked",
                user_id=rt.user_id,
                revoked=count,
            )
            raise RefreshTokenInvalidError("Refresh token 已被同步使用,family 撤銷")

        new_pair = await self._issue_token_pair(user, ip_address=ip_address, user_agent=user_agent)

        await audit(
            self.session,
            actor_id=user.id,
            actor_role=user.role,
            action="auth.refresh",
            entity_type="user",
            entity_id=user.id,
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        return new_pair

    async def logout(
        self,
        *,
        refresh_token: str,
        access_token_claims: dict[str, Any] | None = None,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        """登出:撤銷 refresh token + 把 access token jti 加入 Redis denylist"""
        rt = await self.refresh_repo.find_active_by_raw(refresh_token)
        actor_id: str | None = None
        actor_role: str | None = None
        if rt is not None:
            await self.refresh_repo.revoke(rt.id)
            actor_id = rt.user_id
            user = await self.user_repo.get_by_id(actor_id)
            if user:
                actor_role = user.role

        if access_token_claims:
            jti = access_token_claims.get("jti")
            if jti:
                ttl = jwt_remaining_ttl(access_token_claims)
                await add_jwt_to_denylist(jti, ttl)

        if actor_id:
            await audit(
                self.session,
                actor_id=actor_id,
                actor_role=actor_role,
                action="auth.logout",
                entity_type="user",
                entity_id=actor_id,
                request_id=request_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        await self.session.commit()

    # 對外查詢(給其他模組用)

    async def get_user_by_id(self, user_id: str) -> UserDetail | None:
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            return None
        return _to_user_detail(user)

    async def get_users_batch(self, user_ids: list[str]) -> list[UserDetail]:
        """批次取(admin 列表用,設計 06 §12.4)— 避免 N+1"""
        rows = await self.user_repo.get_many_by_ids(user_ids)
        return [_to_user_detail(u) for u in rows]

    async def count_active_employees_by_sites(self, sites: list[str]) -> dict[str, int]:
        """各廠區 ACTIVE 員工數(:排除 DEPENDENT,-17)"""
        return await self.user_repo.count_active_employees_by_sites(sites)

    # 眷屬 CRUD(:含 include_inactive 支援)

    async def list_dependents(
        self, employee_user_id: str, *, include_inactive: bool = False
    ) -> list[DependentRef]:
        """:include_inactive=True 給歷史 ownership(-7)"""
        rows = await self.dependent_repo.list_by_employee(
            employee_user_id, include_inactive=include_inactive
        )
        return [
            DependentRef(
                id=d.id,
                user_id=d.user_id or d.id,
                name=d.name,
                relationship=DependentRelationship(d.relationship),
            )
            for d in rows
        ]

    async def get_dependents_owned(
        self, dependent_ids: list[str], employee_user_id: str
    ) -> list[DependentRef]:
        """報名時驗 dependent_ids 屬該員工 + ACTIVE"""
        rows = await self.dependent_repo.get_many_by_ids_owned(dependent_ids, employee_user_id)
        return [
            DependentRef(
                id=d.id,
                user_id=d.user_id or d.id,
                name=d.name,
                relationship=DependentRelationship(d.relationship),
            )
            for d in rows
        ]

    async def get_dependent_by_user_id(self, user_id: str) -> DependentRef | None:
        """:用 dependent.user_id 反查 — notification fallback / registration ownership"""
        d = await self.dependent_repo.get_by_user_id(user_id)
        if d is None:
            return None
        return DependentRef(
            id=d.id,
            user_id=d.user_id or d.id,
            name=d.name,
            relationship=DependentRelationship(d.relationship),
        )

    async def get_employee_for_dependent(self, dependent_id: str) -> UserDetail | None:
        """:給 notification 反查員工 inbox 用(避免直接 import auth.models)"""
        dep = await self.dependent_repo.get_by_id(dependent_id)
        if dep is None:
            return None
        return await self.get_user_by_id(str(dep.employee_user_id))

    async def list_dependents_detail(self, employee_user_id: str) -> list[DependentResponse]:
        """API 用 — 含完整欄位(只列 ACTIVE)"""
        rows = await self.dependent_repo.list_by_employee(employee_user_id, include_inactive=False)
        return [
            DependentResponse(
                id=d.id,
                name=d.name,
                relationship=DependentRelationship(d.relationship),
                identification=d.identification,
                status=DependentStatus(d.status),
                created_at=d.created_at,
            )
            for d in rows
        ]

    async def add_dependent(
        self,
        *,
        employee_user_id: str,
        name: str,
        relationship: str,
        identification: str | None,
        actor_role: str = "EMPLOYEE",
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> DependentResponse:
        #:service 層 RBAC 守衛
        from app.modules.auth.dependencies import require_service_actor

        require_service_actor(actor_role, {"EMPLOYEE", "ADMIN"})
        dep = await self.dependent_repo.create(
            employee_user_id=employee_user_id,
            name=name,
            relationship=relationship,
            identification=identification,
        )
        await audit(
            self.session,
            actor_id=employee_user_id,
            actor_role=actor_role,
            action="auth.add_dependent",
            entity_type="dependent",
            entity_id=dep.id,
            after={"name": name, "relationship": relationship, "user_id": dep.user_id},
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        return DependentResponse(
            id=dep.id,
            name=dep.name,
            relationship=DependentRelationship(dep.relationship),
            identification=dep.identification,
            status=DependentStatus(dep.status),
            created_at=dep.created_at,
        )

    async def remove_dependent(
        self,
        *,
        dependent_id: str,
        employee_user_id: str,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        ok = await self.dependent_repo.soft_delete_owned(dependent_id, employee_user_id)
        if not ok:
            raise DependentNotFoundError(f"眷屬 {dependent_id} 不存在或非本人擁有")
        await audit(
            self.session,
            actor_id=employee_user_id,
            actor_role="EMPLOYEE",
            action="auth.remove_dependent",
            entity_type="dependent",
            entity_id=dependent_id,
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()

    # Internal helpers

    async def _issue_token_pair(
        self,
        user: User,
        *,
        ip_address: str | None,
        user_agent: str | None,
    ) -> TokenPair:
        #:DEPENDENT 不可簽 access/refresh token(defense-in-depth)
        if user.role == "DEPENDENT":
            from app.core.exceptions import ForbiddenError

            raise ForbiddenError("DEPENDENT 不可簽發 access/refresh token")
        access_token, _jti, _exp = encode_access_token(
            sub=user.id,
            claims={
                "employee_id": user.employee_id,
                "name": user.name,
                "email": user.email,
                "site": user.site,
                "role": user.role,
            },
        )
        raw_refresh = secrets.token_urlsafe(48)
        await self.refresh_repo.create(
            user_id=user.id,
            raw_token=raw_refresh,
            ttl_seconds=settings.refresh_token_ttl_seconds,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        return TokenPair(
            access_token=access_token,
            refresh_token=raw_refresh,
            expires_in=settings.access_token_ttl_seconds,
        )

    @staticmethod
    async def verify_access_token(token: str) -> dict[str, Any]:
        """供 dependency 使用:驗 JWT + denylist + 回 claims"""
        if not token:
            raise UnauthenticatedError("缺少 access token")
        return await decode_and_verify_token(token)


def _to_user_detail(user: User) -> UserDetail:
    return UserDetail(
        id=user.id,
        employee_id=user.employee_id,
        name=user.name,
        email=user.email,
        department=user.department,
        site=user.site,
        role=user.role,
        status=user.status,
    )
