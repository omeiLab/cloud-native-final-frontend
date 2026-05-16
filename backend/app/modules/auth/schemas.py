"""auth 模組 API request / response schemas"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.shared.enums import (
    DependentRelationship,
    DependentStatus,
    Role,
    Site,
    UserStatus,
)


class AuthorizeUrlResponse(BaseModel):
    """GET /auth/oidc/authorize-url 回應"""

    authorize_url: str
    state: str


class OIDCCallbackRequest(BaseModel):
    """POST /auth/oidc/callback 請求"""

    code: str = Field(..., min_length=1, max_length=2048)
    state: str = Field(..., min_length=1, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer" # noqa: S105 — OAuth bearer scheme literal
    expires_in: int = Field(..., description="access token TTL (秒)")


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    """GET /auth/me 回應"""

    model_config = ConfigDict(frozen=True)

    id: str
    employee_id: str
    name: str
    email: str
    department: str | None
    site: Site
    role: Role
    status: UserStatus


#:員工眷屬 schemas


class DependentCreateRequest(BaseModel):
    """POST /me/dependents 請求"""

    name: str = Field(..., min_length=1, max_length=100)
    relationship: DependentRelationship
    identification: str | None = Field(None, max_length=50)


class DependentResponse(BaseModel):
    """GET / POST /me/dependents 回應"""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    relationship: DependentRelationship
    identification: str | None
    status: DependentStatus
    created_at: datetime
