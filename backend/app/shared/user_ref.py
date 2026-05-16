"""跨模組共用 User DTO — 對齊設計 §13.2"""

from pydantic import BaseModel, ConfigDict

from app.shared.enums import Role, Site, UserStatus


class UserRef(BaseModel):
    """簡略 user 引用(id + name + site)"""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    site: Site


class UserDetail(BaseModel):
    """完整 user 資訊(不含密碼 / refresh token)。

    :DEPENDENT user 的 employee_id / email 為 NULL(眷屬不獨立登入,
    所有操作以員工身分執行;email 透過 dependents.employee_user_id 反查員工)。
    """

    model_config = ConfigDict(frozen=True)

    id: str
    employee_id: str | None = None # DEPENDENT: NULL
    name: str
    email: str | None = None # DEPENDENT: NULL
    department: str | None = None
    site: Site
    role: Role
    status: UserStatus
