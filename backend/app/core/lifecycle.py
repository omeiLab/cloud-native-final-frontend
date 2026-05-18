"""Pod 生命週期 — SIGTERM 處理(對應 §Backlog graceful shutdown)"""

import asyncio
import contextlib
import signal
from typing import Any

from fastapi import FastAPI

from app.core.logging import get_logger

logger = get_logger(__name__)

_shutdown_callbacks: list[Any] = []


def register_shutdown_callback(coro_factory: Any) -> None:
    """讓模組註冊 graceful-shutdown 動作(例如 WebSocket close frame、in-flight request 等)"""
    _shutdown_callbacks.append(coro_factory)


async def _on_sigterm() -> None:
    logger.info("sigterm_received_starting_graceful_shutdown")
    for cb in _shutdown_callbacks:
        try:
            result = cb()
            if asyncio.iscoroutine(result):
                await result
        except Exception:
            logger.exception("shutdown_callback_failed", handler=getattr(cb, "__name__", "?"))


def register_lifecycle(app: FastAPI) -> None:
    """主入口由 main.py 的 lifespan() 呼叫 bind_signal_handlers()。
    此函式留給 router 註冊,目前無需 hook。
    """
    _ = app # 預留


def bind_signal_handlers() -> None:
    """於 lifespan startup 階段呼叫(取代 deprecated @app.on_event)"""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError, RuntimeError):
            # NotImplementedError: Windows / 部分 sandbox 不支援
            # RuntimeError: pytest-asyncio 子線程跑 lifespan(set_wakeup_fd 限主線程)
            loop.add_signal_handler(sig, lambda: asyncio.create_task(_on_sigterm()))
    logger.info("lifecycle_signals_bound")
