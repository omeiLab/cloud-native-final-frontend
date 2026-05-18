"""FastAPI 依賴注入 — 取得當前使用者 + DEPENDENT 守衛(/21)"""

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_rw_session
from app.core.exceptions import ForbiddenError, UnauthenticatedError
from app.modules.auth.service import AuthService, AuthServiceProtocol
from app.shared.enums import Role
from app.shared.user_ref import UserDetail

bearer_scheme = HTTPBearer(auto_error=False)


async def get_auth_service() -> AsyncIterator[AuthService]:
    async for session in get_rw_session():
        yield AuthService(session)


def build_auth_service(session: AsyncSession) -> AuthServiceProtocol:
    """非 FastAPI Depends 路徑使用(scheduler / 跨模組 service caller)。

    回傳 Protocol 型別以避開 caller 直接 import 具體 AuthService 類別
    (§5.1 規則 2:跨模組注入應走 *ServiceProtocol)。
    """
    return AuthService(session)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def assert_api_user(user: UserDetail) -> None:
    """ / -21:所有 API entry point(HTTP / WS / token issuance)的最終守衛。

    DEPENDENT 角色不獨立登入、不可呼叫 API。HTTP 在 get_current_user 內呼叫;
    WS auth handshake 內 re-query DB user 後也要呼叫;_issue_token_pair / refresh
    開頭也要呼叫(雖然 OIDC 不會發 DEPENDENT token,但 defense-in-depth)。
    """
    if user.role == Role.DEPENDENT:
        raise UnauthenticatedError("DEPENDENT 角色無 API 權限")


def require_service_actor(actor_role: str, allowed: set[str]) -> None:
    """:service 層內部呼叫者(非 endpoint dependency)的角色驗證。

    用於 service 內部接收 actor_role: str 參數時,防誤傳 / 跨模組信任邊界破壞。
    """
    if actor_role not in allowed:
        raise ForbiddenError(f"actor_role='{actor_role}' 不在 allowed={sorted(allowed)}")


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    auth_service: AuthServiceDep,
) -> UserDetail:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthenticatedError("缺少 Authorization Bearer header")
    claims = await AuthService.verify_access_token(credentials.credentials)
    request.state.user_claims = claims
    user_id = claims.get("sub")
    if not user_id:
        raise UnauthenticatedError("Access token 缺 sub claim")
    user = await auth_service.get_user_by_id(user_id)
    if user is None:
        raise UnauthenticatedError("使用者不存在")
    if str(user.status) != "ACTIVE":
        raise UnauthenticatedError(f"使用者已停權(status={user.status})")
    #:DEPENDENT 不可呼叫 API
    assert_api_user(user)
    return user


CurrentUser = Annotated[UserDetail, Depends(get_current_user)]


def require_role(role: Role) -> Callable[[UserDetail], Awaitable[UserDetail]]:
    """限定角色(ADMIN 隱含具備所有權限,ADMIN_VIEWER 不隱含)"""

    async def _check(user: CurrentUser) -> UserDetail:
        if user.role == Role.ADMIN:
            return user
        if user.role != role:
            raise ForbiddenError(f"需要 {role} 角色")
        return user

    return _check


def require_admin_read() -> Callable[[UserDetail], Awaitable[UserDetail]]:
    """admin 唯讀路徑:ADMIN 或 ADMIN_VIEWER 都通過(RBAC 細分)。
    用於 dashboard / list(mask_pii=true)/ sites count 等讀取 endpoints。
    """

    async def _check(user: CurrentUser) -> UserDetail:
        if user.role in (Role.ADMIN, Role.ADMIN_VIEWER):
            return user
        raise ForbiddenError("需要 ADMIN 或 ADMIN_VIEWER 角色")

    return _check


def require_admin_full() -> Callable[[UserDetail], Awaitable[UserDetail]]:
    """admin 全權限:僅 ADMIN(不含 VIEWER)。用於改狀態 / 取明文 PII / 匯出。"""

    async def _check(user: CurrentUser) -> UserDetail:
        if user.role == Role.ADMIN:
            return user
        raise ForbiddenError("需要 ADMIN 角色(ADMIN_VIEWER 不夠)")

    return _check
