"""NotificationService.send / retry / mark_read 單元測試"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.notification.errors import NotificationNotFoundError
from app.modules.notification.service import NotificationService


def _user_detail(user_id: str = "01HUUXXXXXXXXXXXXXXXXXXXXX") -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        name="Alice",
        email="alice@example.com",
        role="EMPLOYEE",
        site="HSINCHU",
        status="ACTIVE",
    )


def _orm_notification(
    *,
    n_id: str = "01HNOTXXXXXXXXXXXXXXXXXXXX",
    user_id: str = "01HUUXXXXXXXXXXXXXXXXXXXXX",
    channel: str = "EMAIL",
    type: str = "LOTTERY_WON",
    status: str = "PENDING",
    retry_count: int = 0,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=n_id,
        user_id=user_id,
        channel=channel,
        type=type,
        title="t",
        body="b",
        payload={},
        status=status,
        retry_count=retry_count,
        sent_at=None,
        read_at=None,
        created_at=datetime.now(UTC),
        last_error=None,
    )


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> NotificationService:
    """mocked NotificationService — repo / auth_svc / session AsyncMock"""
    s = NotificationService.__new__(NotificationService)
    s.session = AsyncMock()
    s.auth_svc = AsyncMock()
    s.repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_send_lottery_won_creates_3_pending_dispatches_all(svc: NotificationService) -> None:
    """LOTTERY_WON 預設 EMAIL+IN_APP+WEBSOCKET 三條;每條 INSERT PENDING + dispatch"""
    svc.auth_svc.get_user_by_id = AsyncMock(return_value=_user_detail())
    svc.repo.create = AsyncMock(
        side_effect=lambda **kw: _orm_notification(n_id=kw["notification_id"])
    )
    # patch _dispatch_one 避免真的打 SMTP / Redis
    svc._dispatch_one = AsyncMock(return_value=None) # type: ignore[method-assign]

    await svc.send(
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        type="LOTTERY_WON",
        payload={"event_title": "家庭日", "confirmation_deadline": ""},
    )
    assert svc.repo.create.await_count == 3
    assert svc._dispatch_one.await_count == 3
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_send_lottery_lost_skips_email_due_to_empty_template(
    svc: NotificationService,
) -> None:
    """LOTTERY_LOST 預設只有 IN_APP;email body 為空也不該被 INSERT(skip)"""
    svc.auth_svc.get_user_by_id = AsyncMock(return_value=_user_detail())
    svc.repo.create = AsyncMock(
        side_effect=lambda **kw: _orm_notification(n_id=kw["notification_id"])
    )
    svc._dispatch_one = AsyncMock(return_value=None) # type: ignore[method-assign]

    await svc.send(
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        type="LOTTERY_LOST",
        payload={"event_title": "家庭日"},
    )
    # NOTIFICATION_CONFIG['LOTTERY_LOST'] 只有 IN_APP,且 IN_APP 的 body_text 不為空 → 1 筆
    assert svc.repo.create.await_count == 1
    call = svc.repo.create.await_args_list[0]
    assert call.kwargs["channel"] == "IN_APP"


@pytest.mark.asyncio
async def test_send_user_not_found_silently_returns(svc: NotificationService) -> None:
    """user 不存在 → 不阻擋上游流程,不 INSERT,不 raise"""
    svc.auth_svc.get_user_by_id = AsyncMock(return_value=None)
    svc.repo.create = AsyncMock()

    await svc.send(
        user_id="GHOST",
        type="LOTTERY_WON",
        payload={"event_title": "x", "confirmation_deadline": "x"},
    )
    svc.repo.create.assert_not_awaited()


@pytest.mark.asyncio
async def test_mark_read_already_read_is_idempotent(svc: NotificationService) -> None:
    """已讀的通知 mark_read 應為冪等,不該 raise"""
    svc.repo.mark_read = AsyncMock(return_value=False) # 已讀 → 0 rows updated
    svc.repo.get_by_id = AsyncMock(return_value=_orm_notification(channel="IN_APP"))
    # 模擬已讀(read_at != None 但 mark_read 條件 IS NULL → False)
    notification = svc.repo.get_by_id.return_value
    notification.read_at = datetime.now(UTC)

    await svc.mark_read("01HNOTXXXXXXXXXXXXXXXXXXXX", "01HUUXXXXXXXXXXXXXXXXXXXXX")
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_mark_read_others_notification_returns_notfound(svc: NotificationService) -> None:
    """別人的 notification → NotFound(防越權探測)"""
    svc.repo.mark_read = AsyncMock(return_value=False)
    other = _orm_notification(channel="IN_APP")
    other.user_id = "OTHER_USER"
    svc.repo.get_by_id = AsyncMock(return_value=other)

    with pytest.raises(NotificationNotFoundError):
        await svc.mark_read("01HNOTXXXXXXXXXXXXXXXXXXXX", "01HUUXXXXXXXXXXXXXXXXXXXXX")


@pytest.mark.asyncio
async def test_retry_pending_email_failure_increments_retry_count(
    svc: NotificationService,
) -> None:
    """email send 失敗 + retry_count 0 → mark_failed (retry_count 1) 而非 terminal"""
    failing_n = _orm_notification(channel="EMAIL", retry_count=0)
    svc.repo.find_pending_for_retry = AsyncMock(return_value=[failing_n])
    svc.repo.mark_failed = AsyncMock()
    svc.repo.mark_failed_terminal = AsyncMock()
    svc.repo.mark_sent = AsyncMock()
    svc._send_email = AsyncMock(side_effect=RuntimeError("smtp down")) # type: ignore[method-assign]

    processed = await svc.retry_pending()
    assert processed == 0
    svc.repo.mark_failed.assert_awaited_once()
    svc.repo.mark_failed_terminal.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_pending_third_failure_marks_terminal(svc: NotificationService) -> None:
    """retry_count 已 2 + 再 fail → +1=3 達 _RETRY_MAX → mark_failed_terminal"""
    failing_n = _orm_notification(channel="EMAIL", retry_count=2)
    svc.repo.find_pending_for_retry = AsyncMock(return_value=[failing_n])
    svc.repo.mark_failed = AsyncMock()
    svc.repo.mark_failed_terminal = AsyncMock()
    svc._send_email = AsyncMock(side_effect=RuntimeError("smtp down")) # type: ignore[method-assign]

    await svc.retry_pending()
    svc.repo.mark_failed_terminal.assert_awaited_once()
    svc.repo.mark_failed.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_pending_email_success_marks_sent(svc: NotificationService) -> None:
    n = _orm_notification(channel="EMAIL", retry_count=1)
    svc.repo.find_pending_for_retry = AsyncMock(return_value=[n])
    svc.repo.mark_sent = AsyncMock()
    svc.repo.mark_failed = AsyncMock()
    svc._send_email = AsyncMock(return_value=None) # type: ignore[method-assign]

    processed = await svc.retry_pending()
    assert processed == 1
    svc.repo.mark_sent.assert_awaited_once()
    svc.repo.mark_failed.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_unread_count_returns_unread_count_dto(svc: NotificationService) -> None:
    """API path coverage — get_unread_count 回 UnreadCount{unread_count}"""
    svc.repo.get_unread_in_app_count = AsyncMock(return_value=7)

    result = await svc.get_unread_count("01HUUXXXXXXXXXXXXXXXXXXXXX")
    assert result.unread_count == 7


@pytest.mark.asyncio
async def test_mark_all_read_returns_count(svc: NotificationService) -> None:
    """API path coverage — mark_all_read 回 int 計數"""
    svc.repo.mark_all_read_for_user = AsyncMock(return_value=12)

    n = await svc.mark_all_read("01HUUXXXXXXXXXXXXXXXXXXXXX")
    assert n == 12
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_list_in_app_notifications_includes_unread_count(
    svc: NotificationService,
) -> None:
    """API path coverage — list 對齊設計 05 §12.1 一次回 unread_count + has_next"""
    svc.repo.list_in_app_for_user = AsyncMock(return_value=([], 25))
    svc.repo.get_unread_in_app_count = AsyncMock(return_value=3)

    result = await svc.list_in_app_notifications("01HUUXXXXXXXXXXXXXXXXXXXXX", page=1, page_size=20)
    assert result.total == 25
    assert result.unread_count == 3
    assert result.has_next is True # 25 > 1*20

    # page=2:1*20<25 → still has_next False
    result_p2 = await svc.list_in_app_notifications(
        "01HUUXXXXXXXXXXXXXXXXXXXXX", page=2, page_size=20
    )
    assert result_p2.has_next is False # 2*20 >= 25


@pytest.mark.asyncio
async def test_retry_pending_websocket_failure_increments_retry(
    svc: NotificationService,
) -> None:
    """retry_pending WS path coverage — _send_websocket 失敗也走 retry/terminal 分支"""
    failing_ws = _orm_notification(channel="WEBSOCKET", retry_count=1)
    svc.repo.find_pending_for_retry = AsyncMock(return_value=[failing_ws])
    svc.repo.mark_failed = AsyncMock()
    svc._send_websocket = AsyncMock(side_effect=RuntimeError("redis down")) # type: ignore[method-assign]

    await svc.retry_pending()
    svc.repo.mark_failed.assert_awaited_once()


@pytest.mark.asyncio
async def test_send_writes_audit_log(svc: NotificationService) -> None:
    """:send 應寫 BR-09 audit log"""
    import unittest.mock

    svc.auth_svc.get_user_by_id = AsyncMock(return_value=_user_detail())
    svc.repo.create = AsyncMock(
        side_effect=lambda **kw: _orm_notification(n_id=kw["notification_id"])
    )
    svc._dispatch_one = AsyncMock(return_value=None) # type: ignore[method-assign]

    with unittest.mock.patch(
        "app.modules.notification.service.audit", new_callable=AsyncMock
    ) as audit_mock:
        await svc.send(
            user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
            type="LOTTERY_WON",
            payload={"event_title": "x", "confirmation_deadline": "y"},
        )
        audit_mock.assert_awaited_once()
        kwargs = audit_mock.await_args.kwargs
        assert kwargs["action"] == "notification.send"
        assert kwargs["actor_role"] == "SYSTEM"
        assert kwargs["after"]["type"] == "LOTTERY_WON"


@pytest.mark.asyncio
async def test_send_batch_per_user_failure_does_not_break_others(
    svc: NotificationService,
) -> None:
    """batch 內某 user send 失敗 → log + 繼續處理下一個"""
    svc.auth_svc.get_user_by_id = AsyncMock(
        side_effect=[_user_detail("u1"), Exception("auth down"), _user_detail("u3")]
    )
    svc.repo.create = AsyncMock(
        side_effect=lambda **kw: _orm_notification(n_id=kw["notification_id"])
    )
    svc._dispatch_one = AsyncMock(return_value=None) # type: ignore[method-assign]

    await svc.send_batch(
        user_ids=["u1", "u2", "u3"],
        type="LOTTERY_WON",
        payload_per_user={
            "u1": {"event_title": "x", "confirmation_deadline": "y"},
            "u2": {"event_title": "x", "confirmation_deadline": "y"},
            "u3": {"event_title": "x", "confirmation_deadline": "y"},
        },
    )
    # u1 + u3 各 3 條(EMAIL/IN_APP/WS),共 6 筆 create
    assert svc.repo.create.await_count == 6


# 為了 test 變數,而非實際使用
_ = timedelta
