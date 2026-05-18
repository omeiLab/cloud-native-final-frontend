"""全域 middleware — X-Request-Id 追蹤 + 共用 client meta 抽取"""

import ipaddress
import re
import uuid

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings

# audit_logs.request_id 是 CHAR(36),只接受標準 UUID 格式;
# 防止用戶端送過長字串導致 PG truncation error 把寫入 audit 的端點癱瘓
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# audit_logs.user_agent 沒有上限會被當儲存型 DOS 注入(16MB UA → 表膨脹 + 同步延遲);
# 截到 512 字夠 forensic,並符合多數合理瀏覽器 UA 字串長度。
_UA_MAX_LEN = 512


def _normalize_request_id(client_value: str | None) -> str:
    """信任 client X-Request-Id 但只接受合法 UUID;否則自產一個"""
    if client_value and len(client_value) <= 36 and _UUID_RE.match(client_value):
        return client_value
    return str(uuid.uuid4())


def _safe_ip(value: str | None) -> str | None:
    """驗證合法 IP 字串(IPv4 / IPv6),不合法回 None。

    防 audit_logs.ip_address(INET 型別)寫入 'not-an-ip' 觸發 PG
    `invalid input syntax for type inet` 把整個 audit-writing endpoint 拒收。
    """
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


class RequestIdMiddleware(BaseHTTPMiddleware):
    """為每個 request 產生 X-Request-Id 並注入 structlog context + response header"""

    async def dispatch(self, request: Request, call_next): # type: ignore[no-untyped-def]
        request_id = _normalize_request_id(request.headers.get("X-Request-Id"))
        request.state.request_id = request_id

        with structlog.contextvars.bound_contextvars(request_id=request_id):
            response: Response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


def register_middleware(app: FastAPI) -> None:
    # CORS 必須在最外層(starlette 中間件 LIFO),才能在 preflight OPTIONS
    # 被任何業務邏輯處理前直接回 204 + Access-Control-Allow-* headers。
    origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True, # 允許帶 cookie / Authorization header
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
        max_age=600,
    )
    app.add_middleware(RequestIdMiddleware)


def get_client_meta(request: Request) -> tuple[str | None, str | None, str | None]:
    """共用:抽 request_id / client IP(優先 X-Forwarded-For)/ User-Agent。

    所有 audit-writing endpoint 都應該用這個,確保 IP 取法一致 + 必經以下驗證:

    - IP 必須為合法 IPv4 / IPv6(防 PG INET 型別 parse error DOS)
    - User-Agent 截到 512 字(防 audit_logs.user_agent Text 無上限儲存型 DOS)

    XFF spoofing note:lab 階段未實作 trusted-proxy CIDR 過濾,client 可送任意
    XFF 值假冒 forensic IP。生產環境應該由 ingress-nginx `use-forwarded-headers: false`
    + `proxy-real-ip-cidr` 把唯一可信來源(自家 ingress)鎖定。
    """
    request_id = getattr(request.state, "request_id", None)

    # 優先 XFF 第一個 token,不合法 fallback 連線 socket peer
    raw_ip: str | None = None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        raw_ip = xff.split(",")[0].strip()
    ip = _safe_ip(raw_ip)
    if ip is None:
        ip = _safe_ip(request.client.host if request.client else None)

    ua = request.headers.get("user-agent")
    if ua and len(ua) > _UA_MAX_LEN:
        ua = ua[:_UA_MAX_LEN]
    return request_id, ip, ua
