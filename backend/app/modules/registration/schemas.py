"""registration 模組 API request / response schemas

:dependent_ids list 改為單一 as_dependent_id(代報眷屬)。員工自報時 NULL,
代報時填一個 dependent.id;每筆 reg 只對一個身分(員工自己 OR 一位眷屬)。
若員工想為 N 位眷屬報名,呼叫 N 次 POST /registrations。

⚠️ 起 (前端反饋訴求 1):前端改用 ticket_type.name 過濾成人/兒童
身分,as_dependent_id 為 deprecated 欄位。後端容忍但建議省略。
"""

from pydantic import BaseModel, Field

# Crockford Base32 字元集(ULID 規範)— 排除 ILOU 防混淆
_ULID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"


class CreateRegistrationRequest(BaseModel):
    session_id: str = Field(..., min_length=26, max_length=26, pattern=_ULID_PATTERN)
    ticket_type_id: str = Field(..., min_length=26, max_length=26, pattern=_ULID_PATTERN)
    #:代報眷屬時填 dependents.id;員工自報時 NULL
    # deprecated(訴求 1):前端應省略,改用 ticket_type 命名區分身分
    as_dependent_id: str | None = Field(
        default=None,
        min_length=26,
        max_length=26,
        pattern=_ULID_PATTERN,
        description=(
            "[DEPRECATED ] 代報眷屬 ID;前端應停用,改以 ticket_type.name 命名區分成人/兒童"
        ),
        deprecated=True,
    )
