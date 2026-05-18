"""WebSocket per-replica 連線管理器(對齊 §Backlog 連線管理)。

每個副本維護本地連線表 `connections: dict[user_id, list[WebSocket]]`,
同一使用者多分頁支援(同分頁不會重複 register;若需要去重交由 endpoint 端控)。
跨副本廣播由 NotificationService._send_websocket → Redis Pub/Sub 完成,
本副本透過 ws_pubsub.py 訂閱 user:* 收到後再呼叫 send_to_user 推送。
"""

import asyncio

from fastapi import WebSocket

from app.core.logging import get_logger
from app.core.metrics import (
    WEBSOCKET_ACTIVE_CONNECTIONS,
    WEBSOCKET_CONNECTIONS,
    WEBSOCKET_MESSAGES_DROPPED,
    WEBSOCKET_MESSAGES_SENT,
)

logger = get_logger(__name__).bind(component="notification")


class ConnectionManager:
    def __init__(self) -> None:
        # user_id → list of WebSocket(同 user 多分頁,順序維持 register 順序)
        self._connections: dict[str, list[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._closing = False

    async def register(self, user_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.setdefault(user_id, []).append(ws)
        WEBSOCKET_CONNECTIONS.labels(status="opened").inc()
        WEBSOCKET_ACTIVE_CONNECTIONS.inc()
        logger.info(
            "ws_registered", user_id=user_id, total_for_user=len(self._connections[user_id])
        )

    async def unregister(self, user_id: str, ws: WebSocket) -> None:
        """端點 finally 階段呼叫;若 close_all 已先移除該連線(closing 中),
        本方法成為 noop,不重複 inc closed metric(:雙重計數)"""
        removed = False
        async with self._lock:
            conns = self._connections.get(user_id, [])
            if ws in conns:
                conns.remove(ws)
                removed = True
            if not conns:
                self._connections.pop(user_id, None)
        if removed:
            WEBSOCKET_CONNECTIONS.labels(status="closed").inc()
            WEBSOCKET_ACTIVE_CONNECTIONS.dec()
            logger.info("ws_unregistered", user_id=user_id)

    async def send_to_user(
        self, user_id: str, message: str, *, msg_type: str = "notification"
    ) -> int:
        """推訊息給該 user 的所有本副本連線;回傳成功推送數。
        遠端連線失效時靜默清理。
        """
        if self._closing:
            return 0
        async with self._lock:
            conns = list(self._connections.get(user_id, []))
        if not conns:
            WEBSOCKET_MESSAGES_DROPPED.inc()
            return 0
        sent = 0
        for ws in conns:
            try:
                await ws.send_text(message)
                sent += 1
            except Exception as e:
                # 連線斷掉 / send 失敗:標記移除(但 unregister 由 endpoint loop 觸發)
                logger.warning("ws_send_failed", user_id=user_id, error=str(e))
        if sent > 0:
            WEBSOCKET_MESSAGES_SENT.labels(type=msg_type).inc(sent)
        return sent

    async def close_all(self, code: int = 1001, reason: str = "Server shutting down") -> int:
        """graceful shutdown:對所有連線送 close frame(對齊 §Backlog)。
        每條連線只算一次 closed(後續 endpoint finally 的 unregister 會被偵測為 noop)"""
        self._closing = True
        async with self._lock:
            all_conns: list[tuple[str, WebSocket]] = []
            for uid, conns in self._connections.items():
                for ws in conns:
                    all_conns.append((uid, ws))
            self._connections.clear()
        for uid, ws in all_conns:
            try:
                await ws.close(code=code, reason=reason)
            except Exception as e:
                logger.warning("ws_close_failed", user_id=uid, error=str(e))
            WEBSOCKET_CONNECTIONS.labels(status="closed").inc()
            WEBSOCKET_ACTIVE_CONNECTIONS.dec()
        logger.info("ws_close_all_done", total=len(all_conns))
        return len(all_conns)

    def total_connections(self) -> int:
        return sum(len(c) for c in self._connections.values())

    def count_for_user(self, user_id: str) -> int:
        """單一 user 已建立的本副本連線數(per-user 連線上限用 —)"""
        return len(self._connections.get(user_id, []))

    def has_user(self, user_id: str) -> bool:
        return user_id in self._connections


# 單例(per-process)— 由 main.py lifespan 啟動時引用
_manager: ConnectionManager | None = None


def get_connection_manager() -> ConnectionManager:
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager


def reset_connection_manager() -> None:
    """測試用"""
    global _manager
    _manager = None
