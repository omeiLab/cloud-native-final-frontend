"""auth 模組 API endpoints"""

from fastapi import APIRouter, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.middleware import get_client_meta
from app.modules.auth.dependencies import (
    AuthServiceDep,
    CurrentUser,
)
from app.modules.auth.schemas import (
    AuthorizeUrlResponse,
    DependentCreateRequest,
    DependentResponse,
    LogoutRequest,
    MeResponse,
    OIDCCallbackRequest,
    RefreshRequest,
    TokenPair,
)
from app.modules.auth.service import AuthService

router = APIRouter()
#:眷屬 CRUD 走 /api/v1/me/* 慣例(對齊 registration_me / ticket_me),
# 不放 /auth/* 下避免「眷屬屬於 auth」的誤解
me_router = APIRouter()


@router.get(
    "/oidc/authorize-url",
    response_model=AuthorizeUrlResponse,
    summary="取得 IdP authorize URL(瀏覽器跳轉去 Auth0 / mock-oidc 登入)",
)
async def oidc_authorize_url(
    auth: AuthServiceDep,
    redirect_uri: str | None = None,
) -> AuthorizeUrlResponse:
    """前端可帶 ?redirect_uri=<...> 指定 callback URL(必須在白名單內);
    不帶則用 `auth0_callback_url` 預設(production cets.alanh.uk)。
    本機 dev 通常帶 http://localhost:5173/auth/callback。"""
    url, state = await auth.build_authorize_url(redirect_uri=redirect_uri)
    return AuthorizeUrlResponse(authorize_url=url, state=state)


@router.post(
    "/oidc/callback",
    response_model=TokenPair,
    summary="OIDC 回呼 — code → access/refresh token",
)
async def oidc_callback(
    body: OIDCCallbackRequest,
    request: Request,
    auth: AuthServiceDep,
) -> TokenPair:
    request_id, ip, ua = get_client_meta(request)
    return await auth.oidc_callback(
        code=body.code,
        state=body.state,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="用 refresh token 換新的 access token(rotate refresh)",
)
async def refresh(
    body: RefreshRequest,
    request: Request,
    auth: AuthServiceDep,
) -> TokenPair:
    request_id, ip, ua = get_client_meta(request)
    return await auth.refresh(
        refresh_token=body.refresh_token,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="登出 — 撤銷 refresh token + access token jti 進 Redis denylist",
)
async def logout(
    body: LogoutRequest,
    request: Request,
    auth: AuthServiceDep,
) -> None:
    # 取出 access token claims(若 header 有)
    access_creds: HTTPAuthorizationCredentials | None = await HTTPBearer(auto_error=False)(request)
    access_claims = None
    if access_creds and access_creds.scheme.lower() == "bearer":
        try:
            access_claims = await AuthService.verify_access_token(access_creds.credentials)
        except Exception:
            access_claims = None # 即使 access token 已過期 / 無效,refresh 還是可撤銷

    request_id, ip, ua = get_client_meta(request)
    await auth.logout(
        refresh_token=body.refresh_token,
        access_token_claims=access_claims,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@router.get(
    "/me",
    response_model=MeResponse,
    summary="當前登入使用者資訊",
)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse(**user.model_dump())


# v1:員工眷屬 CRUD
# ⚠️ DEPRECATED(訴求 1, 前端反饋):
# 前端改用「ticket_type.name 命名 + 條件確認卡片」過濾成人/兒童身分,
# 不再走眷屬路徑。本組 endpoints 保留供既有資料相容,新前端不應呼叫。


@me_router.get(
    "/dependents",
    response_model=list[DependentResponse],
    deprecated=True,
    summary="[DEPRECATED] 當前員工的眷屬清單(起前端不再使用)",
)
async def list_my_dependents(user: CurrentUser, auth: AuthServiceDep) -> list[DependentResponse]:
    return await auth.list_dependents_detail(user.id)


@me_router.post(
    "/dependents",
    response_model=DependentResponse,
    status_code=status.HTTP_201_CREATED,
    deprecated=True,
    summary="[DEPRECATED] 新增眷屬(起前端不再使用)",
)
async def add_my_dependent(
    body: DependentCreateRequest,
    request: Request,
    user: CurrentUser,
    auth: AuthServiceDep,
) -> DependentResponse:
    request_id, ip, ua = get_client_meta(request)
    return await auth.add_dependent(
        employee_user_id=user.id,
        name=body.name,
        relationship=body.relationship.value,
        identification=body.identification,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )


@me_router.delete(
    "/dependents/{dependent_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    deprecated=True,
    summary="[DEPRECATED] 軟刪除眷屬(起前端不再使用)",
)
async def remove_my_dependent(
    dependent_id: str,
    request: Request,
    user: CurrentUser,
    auth: AuthServiceDep,
) -> None:
    request_id, ip, ua = get_client_meta(request)
    await auth.remove_dependent(
        dependent_id=dependent_id,
        employee_user_id=user.id,
        request_id=request_id,
        ip_address=ip,
        user_agent=ua,
    )
