"""ticket 模組 API request schemas"""

from pydantic import BaseModel, Field

_ULID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"


class VerifyTicketRequest(BaseModel):
    """驗票員 scanner 送 QR 解碼字串 + 裝置識別"""

    qr_payload: str = Field(..., min_length=20, max_length=2000)
    device_id: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")
