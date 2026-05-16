"""WebSocket /ws endpoint(對齊設計 05 §14 + §Backlog;)

:不再用 query string token(會被 access log / OTel span / browser history 洩漏)。
改為 accept-then-auth-message 模式:
- accept connection 後等首封 message `{"type":"auth","token":"<jwt>"}`(預設 10s deadline)
- 驗 JWT,失敗 close 4001
- 通過後 register 進 ConnectionManager,進入 ping/pong heartbeat 主迴圈

跨副本廣播由 ws_pubsub.py 訂閱 Redis pattern user:* 後呼叫 manager.send_to_user。
"""

import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.core.db import get_rw_session_maker
from app.core.exceptions import ForbiddenError, TokenExpiredError, UnauthenticatedError
from app.core.logging import get_logger
from app.core.metrics import WEBSOCKET_CONNECTIONS
from app.core.rate_limit import check_rate_limit
from app.core.security import decode_and_verify_token
from app.modules.auth.dependencies import assert_api_user, build_auth_service
from app.modules.notification.ws_manager import get_connection_manager

logger = get_logger(__name__).bind(component="notification")

ws_router = APIRouter()

# 心跳:server 每 30 秒送 ping;60 秒內未收到任何訊息 → 主動關閉
_PING_INTERVAL_SECONDS = 30
_RECV_TIMEOUT_SECONDS = 60

# JWT 驗失敗的 close code(設計 05 §14.1)
_CLOSE_CODE_AUTH_FAILED = 4001
_CLOSE_CODE_GOING_AWAY = 1001
_CLOSE_CODE_RATE_LIMITED = 4008


@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """連線:wss://<host>/ws,**不接 query string token**()。

    流程:
    1. accept(無 token 驗證)
    2. 等首封 auth 訊息 `{"type":"auth","token":"..."}` 在 _ws_auth_timeout 內
    3. 驗 JWT,失敗 close 4001
    4. register + 進入 recv_loop / heartbeat_loop
    5. 任一 task 結束 → unregister + close
    """
    #:per-IP rate limit 防 OOM(惡意 client 開上千條)
    client_ip = _client_ip(websocket)
    try:
        await check_rate_limit(
            key=f"ws:open:{client_ip}",
            limit=settings.ws_open_rate_per_minute_per_ip,
            window_seconds=60,
        )
    except Exception as e:
        # rate limit 觸發 → 不 accept,直接 close
        await websocket.close(code=_CLOSE_CODE_RATE_LIMITED, reason="Too many connections")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        logger.info("ws_rate_limited", ip=client_ip, error=str(e))
        return

    await websocket.accept()

    # 等 auth 訊息(timeout 內未收到 → close 4001)
    try:
        raw = await asyncio.wait_for(
            websocket.receive_text(), timeout=settings.ws_auth_timeout_seconds
        )
    except (TimeoutError, WebSocketDisconnect):
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "Auth timeout")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        return

    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "Invalid auth message")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        return

    if not isinstance(msg, dict) or msg.get("type") != "auth":
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "First message must be auth")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        return

    token = msg.get("token")
    if not isinstance(token, str) or not token:
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "Missing token")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        return

    try:
        claims = await decode_and_verify_token(token)
    except (TokenExpiredError, UnauthenticatedError) as e:
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, str(e))
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        logger.info("ws_auth_rejected", error=str(e))
        return

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "Invalid token claims")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        return

    #:re-query DB user 驗 status='ACTIVE' 且 role 不是 DEPENDENT
    # (HTTP path 在 get_current_user 內呼叫 assert_api_user;WS 之前漏了)
    try:
        maker = get_rw_session_maker()
        async with maker() as db_session:
            auth_svc = build_auth_service(db_session)
            user = await auth_svc.get_user_by_id(user_id)
        if user is None:
            await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "user not found")
            WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
            logger.info("ws_user_not_found", user_id=user_id)
            return
        if str(user.status) != "ACTIVE":
            await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, "user inactive")
            WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
            logger.info("ws_user_inactive", user_id=user_id, status=str(user.status))
            return
        assert_api_user(user) # 拒 DEPENDENT(raises UnauthenticatedError)
    except (ForbiddenError, UnauthenticatedError) as e:
        await _close_safe(websocket, _CLOSE_CODE_AUTH_FAILED, str(e))
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        logger.info("ws_role_rejected", user_id=user_id, error=str(e))
        return

    manager = get_connection_manager()

    #:per-user 連線數上限(防同 user 開過多分頁拖累單副本記憶體)
    if manager.count_for_user(user_id) >= settings.ws_max_connections_per_user:
        await _close_safe(websocket, _CLOSE_CODE_RATE_LIMITED, "Too many connections for this user")
        WEBSOCKET_CONNECTIONS.labels(status="rejected").inc()
        logger.info("ws_per_user_limit", user_id=user_id)
        return

    await manager.register(user_id, websocket)

    # 認證成功確認(前端可選用)
    await websocket.send_text(json.dumps({"type": "auth_ok"}))

    try:
        await _serve(websocket, user_id)
    except WebSocketDisconnect as e:
        logger.info("ws_disconnected", user_id=user_id, code=e.code)
    except Exception:
        logger.exception("ws_loop_failed", user_id=user_id)
    finally:
        await manager.unregister(user_id, websocket)


async def _close_safe(ws: WebSocket, code: int, reason: str) -> None:
    """close 失敗(連線已斷)時靜默"""
    with contextlib.suppress(Exception):
        await ws.close(code=code, reason=reason)


def _client_ip(ws: WebSocket) -> str:
    """從 WebSocket 取 client IP(優先 X-Forwarded-For,否則 client.host)"""
    xff = ws.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    if ws.client is not None:
        return ws.client.host
    return "unknown"


async def _serve(websocket: WebSocket, user_id: str) -> None:
    """並行跑 receive_loop + heartbeat_loop;任一結束就退出"""
    last_recv_event = asyncio.Event()

    async def recv_loop() -> None:
        while True:
            text = await websocket.receive_text()
            last_recv_event.set()
            try:
                obj = json.loads(text)
            except json.JSONDecodeError:
                continue
            mtype = obj.get("type")
            if mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    async def heartbeat_loop() -> None:
        while True:
            await asyncio.sleep(_PING_INTERVAL_SECONDS)
            try:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception:
                return # send 失敗代表連線壞;讓外層處理
            #:直接 wait_for(event.wait()),不需 helper
            try:
                await asyncio.wait_for(last_recv_event.wait(), timeout=_RECV_TIMEOUT_SECONDS)
                last_recv_event.clear()
            except TimeoutError:
                logger.info("ws_pong_timeout", user_id=user_id)
                await websocket.close(code=_CLOSE_CODE_GOING_AWAY, reason="Heartbeat timeout")
                return

    recv_task = asyncio.create_task(recv_loop())
    hb_task = asyncio.create_task(heartbeat_loop())
    try:
        done, pending = await asyncio.wait(
            {recv_task, hb_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
        for t in done:
            exc = t.exception()
            if exc is not None:
                raise exc
    finally:
        for t in (recv_task, hb_task):
            if not t.done():
                t.cancel()


__all__ = ["ws_router"]
