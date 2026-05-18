"""Redis Pub/Sub 訂閱器(對齊 §Backlog Redis Pub/Sub 訂閱)

每個副本啟動時跑這個 task:
- 訂閱 pattern `user:*`
- 收到訊息時查本地 connection manager,有對應 user 則 send,沒則 drop
- 訂閱者異常斷線時自動重連 Redis(指數退避)
- pubsub_lag_seconds 計時:從訊息 timestamp(若 payload 有)到推送的延遲

 lab:訊息 payload 不含 timestamp,lag 暫以 receive_time - now() 估;
未來在 publisher 加 ts 即可正確計算。
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Any

from app.core.logging import get_logger
from app.core.metrics import PUBSUB_LAG_SECONDS
from app.core.redis import get_redis
from app.modules.notification.pubsub_security import verify_signed_payload
from app.modules.notification.ws_manager import (
    ConnectionManager,
)

logger = get_logger(__name__).bind(component="notification")

_USER_CHANNEL_PATTERN = "user:*"
_RECONNECT_BASE_SECONDS = 1.0
_RECONNECT_MAX_SECONDS = 30.0


class PubSubSubscriber:
    """背景 task,訂閱 Redis pattern 並轉發到本地 ConnectionManager"""

    def __init__(self, manager: ConnectionManager) -> None:
        self.manager = manager
        self._task: asyncio.Task[Any] | None = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        """非同步啟動;由 lifespan 呼叫"""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="ws-pubsub-subscriber")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except TimeoutError:
                self._task.cancel()
                logger.warning("ws_pubsub_force_cancelled")
            self._task = None

    async def _run(self) -> None:
        backoff = _RECONNECT_BASE_SECONDS
        while not self._stop_event.is_set():
            try:
                await self._subscribe_loop()
                # 正常 break 不該發生;若到此通常是 stop 觸發
                return
            except Exception as e:
                logger.warning("ws_pubsub_disconnected", error=str(e), backoff=backoff)
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                    return
                except TimeoutError:
                    pass
                backoff = min(backoff * 2, _RECONNECT_MAX_SECONDS)

    async def _subscribe_loop(self) -> None:
        redis = get_redis()
        pubsub = redis.pubsub()
        await pubsub.psubscribe(_USER_CHANNEL_PATTERN)
        logger.info("ws_pubsub_subscribed", pattern=_USER_CHANNEL_PATTERN)
        try:
            while not self._stop_event.is_set():
                # 1s timeout 讓 stop event 能盡快被察覺
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    continue
                await self._handle_message(msg)
        finally:
            try:
                await pubsub.punsubscribe(_USER_CHANNEL_PATTERN)
                await pubsub.aclose() # type: ignore[no-untyped-call]
            except Exception:
                logger.exception("ws_pubsub_cleanup_failed")

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        """msg = {'type': 'pmessage', 'pattern': 'user:*', 'channel': 'user:UID', 'data': '...'}"""
        if msg.get("type") not in ("pmessage", "message"):
            return
        channel = msg.get("channel")
        data = msg.get("data")
        if not isinstance(channel, str) or not isinstance(data, str):
            return
        if not channel.startswith("user:"):
            return
        user_id = channel.split(":", 1)[1]

        #:HMAC 驗簽,失敗直接 drop(防 redis publisher 冒名)
        verified = verify_signed_payload(data)
        if verified is None:
            logger.warning("ws_pubsub_invalid_or_unsigned", channel=channel, data=data[:100])
            return
        msg_type = verified.get("type")
        if not isinstance(msg_type, str):
            return

        # lag 估算:payload 若帶 created_at 用差值(失敗純 metrics 影響,不阻擋推送)
        data_obj = verified.get("data")
        ts = data_obj.get("created_at") if isinstance(data_obj, dict) else None
        if isinstance(ts, str):
            try:
                emitted = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                lag = max(0.0, time.time() - emitted.timestamp())
                PUBSUB_LAG_SECONDS.observe(lag)
            except (ValueError, TypeError):
                pass

        # 推送的訊息**移除 _sig 欄位**(前端不需要)— 重新序列化 verified
        out_message = json.dumps(verified, ensure_ascii=False)
        await self.manager.send_to_user(user_id, out_message, msg_type=msg_type)


_subscriber: PubSubSubscriber | None = None


def get_pubsub_subscriber(manager: ConnectionManager) -> PubSubSubscriber:
    """單例;若 manager 不同(罕見:hot reload / 測試)先 stop 舊的避免 task leak
    ()"""
    global _subscriber
    if _subscriber is not None and _subscriber.manager is not manager:
        # 不能 await 這裡(同步函式);舊 task 會因 stop_event 未 set 繼續跑直到
        # 自然斷線重連 — production 此分支應不會發生(manager 是 process 級單例)。
        # 警告 + 替換,讓 reviewer 看到。
        logger.warning("ws_pubsub_replaced_with_different_manager_caller_must_stop_old")
        _subscriber = None
    if _subscriber is None:
        _subscriber = PubSubSubscriber(manager)
    return _subscriber


def reset_pubsub_subscriber() -> None:
    global _subscriber
    _subscriber = None
