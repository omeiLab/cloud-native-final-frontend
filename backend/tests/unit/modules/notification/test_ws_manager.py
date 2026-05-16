"""ConnectionManager unit tests(per-replica 連線管理)"""

from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.modules.notification.ws_manager import ConnectionManager


def _mk_ws() -> Any:
    ws = AsyncMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    return ws


@pytest.mark.asyncio
async def test_register_and_unregister_single_user_single_conn() -> None:
    mgr = ConnectionManager()
    ws = _mk_ws()
    await mgr.register("u1", ws)
    assert mgr.has_user("u1")
    assert mgr.total_connections() == 1

    await mgr.unregister("u1", ws)
    assert not mgr.has_user("u1")
    assert mgr.total_connections() == 0


@pytest.mark.asyncio
async def test_multi_tab_same_user_register_both() -> None:
    """同一 user 多分頁:list 應有兩條"""
    mgr = ConnectionManager()
    ws1 = _mk_ws()
    ws2 = _mk_ws()
    await mgr.register("u1", ws1)
    await mgr.register("u1", ws2)
    assert mgr.total_connections() == 2

    await mgr.unregister("u1", ws1)
    assert mgr.has_user("u1") # 仍有 ws2
    assert mgr.total_connections() == 1


@pytest.mark.asyncio
async def test_send_to_user_pushes_to_all_local_conns() -> None:
    mgr = ConnectionManager()
    ws1 = _mk_ws()
    ws2 = _mk_ws()
    await mgr.register("u1", ws1)
    await mgr.register("u1", ws2)

    sent = await mgr.send_to_user("u1", '{"type":"notification","data":{"id":"x"}}')
    assert sent == 2
    ws1.send_text.assert_awaited()
    ws2.send_text.assert_awaited()


@pytest.mark.asyncio
async def test_send_to_user_no_conn_drops() -> None:
    mgr = ConnectionManager()
    sent = await mgr.send_to_user("ghost", '{"type":"x","data":{}}')
    assert sent == 0


@pytest.mark.asyncio
async def test_send_to_user_during_closing_returns_zero() -> None:
    """graceful shutdown 後不該再推送"""
    mgr = ConnectionManager()
    ws = _mk_ws()
    await mgr.register("u1", ws)
    await mgr.close_all()

    sent = await mgr.send_to_user("u1", "msg")
    assert sent == 0


@pytest.mark.asyncio
async def test_close_all_sends_close_frame_1001() -> None:
    """ §Backlog:graceful shutdown 主動 close 1001"""
    mgr = ConnectionManager()
    ws1 = _mk_ws()
    ws2 = _mk_ws()
    await mgr.register("u1", ws1)
    await mgr.register("u2", ws2)

    closed = await mgr.close_all(code=1001, reason="Server shutting down")
    assert closed == 2
    ws1.close.assert_awaited_once_with(code=1001, reason="Server shutting down")
    ws2.close.assert_awaited_once_with(code=1001, reason="Server shutting down")
    assert mgr.total_connections() == 0


@pytest.mark.asyncio
async def test_unregister_after_close_all_is_noop() -> None:
    """:close_all 之後 endpoint finally 的 unregister 應為 noop,
    不能再 inc closed metric(否則同連線雙計數)"""
    mgr = ConnectionManager()
    ws = _mk_ws()
    await mgr.register("u1", ws)

    await mgr.close_all(code=1001)
    # close_all 已從 _connections 移除 ws;後續 unregister 應 silent
    await mgr.unregister("u1", ws) # 不該 raise / 不該 inc

    assert mgr.total_connections() == 0


@pytest.mark.asyncio
async def test_count_for_user_returns_correct_count() -> None:
    """per-user 連線數上限用 — """
    mgr = ConnectionManager()
    assert mgr.count_for_user("u1") == 0

    ws1 = _mk_ws()
    ws2 = _mk_ws()
    await mgr.register("u1", ws1)
    assert mgr.count_for_user("u1") == 1
    await mgr.register("u1", ws2)
    assert mgr.count_for_user("u1") == 2

    # 不同 user 不互算
    ws_other = _mk_ws()
    await mgr.register("u2", ws_other)
    assert mgr.count_for_user("u1") == 2
    assert mgr.count_for_user("u2") == 1


@pytest.mark.asyncio
async def test_send_failure_does_not_break_other_conns() -> None:
    """單一連線 send 失敗不該影響其他連線"""
    mgr = ConnectionManager()
    ws_bad = _mk_ws()
    ws_bad.send_text = AsyncMock(side_effect=RuntimeError("conn closed"))
    ws_ok = _mk_ws()
    await mgr.register("u1", ws_bad)
    await mgr.register("u1", ws_ok)

    sent = await mgr.send_to_user("u1", "msg")
    assert sent == 1
    ws_ok.send_text.assert_awaited()
