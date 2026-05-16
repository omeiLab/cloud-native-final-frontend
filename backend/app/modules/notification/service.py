"""notification 模組 Service — 三管道發送 / 重試 / 站內讀取(對齊設計 06 §11)

關鍵不變式(設計 06 §11.5 + §11.7):
- 先 INSERT notifications(PENDING)再嘗試 dispatch — 失敗用 retry job 撈
- WS 跨副本透 Redis Pub/Sub `user:{user_id}`,本副本連線表存在則本地推
- 重試指數退避 5/10/15 分鐘,最多 3 次(設計 §11.7)
- retry_pending 取 advisory lock 防多副本並行(對齊 registration / lottery)
"""

import json
from email.message import EmailMessage
from typing import Any, Protocol, runtime_checkable

import aiosmtplib
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.metrics import NOTIFICATION_SEND_FAILURES
from app.core.redis import get_redis
from app.core.ulid import generate_ulid
from app.modules.auth.service import AuthServiceProtocol
from app.modules.notification.errors import NotificationNotFoundError
from app.modules.notification.models import Notification as NotificationORM
from app.modules.notification.pubsub_security import sign_payload
from app.modules.notification.repository import NotificationRepository
from app.modules.notification.templates import (
    NOTIFICATION_CONFIG,
    get_default_channels,
    render_notification,
)
from app.shared.notification_ref import (
    MarkReadResult,
    NotificationItem,
    NotificationListResponse,
    UnreadCount,
)

logger = get_logger(__name__).bind(component="notification")

_RETRY_MAX = 3
_RETRY_BACKOFF_BASE_MIN = 5


@runtime_checkable
class NotificationServiceProtocol(Protocol):
    """跨模組呼叫介面(對齊設計 06 §11.3 完整 7 方法 — 補完)"""

    async def send(
        self,
        user_id: str,
        type: str,
        channels: list[str] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:...

    async def send_batch(
        self,
        user_ids: list[str],
        type: str,
        channels: list[str] | None = None,
        payload_per_user: dict[str, dict[str, Any]] | None = None,
    ) -> None:...

    async def list_in_app_notifications(
        self,
        user_id: str,
        *,
        unread_only: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> "NotificationListResponse":...

    async def mark_read(self, notification_id: str, user_id: str) -> "MarkReadResult":...

    async def mark_all_read(self, user_id: str) -> int:...

    async def get_unread_count(self, user_id: str) -> "UnreadCount":...

    async def retry_pending(self) -> int:...


class NotificationService:
    def __init__(
        self,
        session: AsyncSession,
        auth_svc: AuthServiceProtocol,
    ) -> None:
        self.session = session
        self.auth_svc = auth_svc
        self.repo = NotificationRepository(session)

    # 發送(設計 §11.5)

    async def send(
        self,
        user_id: str,
        type: str,
        channels: list[str] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """發單筆通知(DEPENDENT fallback):

        - 若 user_id 對應 EMPLOYEE/ADMIN/.../VERIFIER → 正常發送(notification.user_id=user_id)
        - 若 user_id 對應 DEPENDENT → 反查 dependents.employee_user_id,
          notification.user_id=員工(投遞 inbox + email),subject_user_id=眷屬,
          payload['as_dependent_name'] 帶眷屬姓名供範本使用
        """
        target_channels = channels or get_default_channels(type)

        user = await self.auth_svc.get_user_by_id(user_id)
        if user is None:
            logger.warning("notification_user_not_found", user_id=user_id, type=type)
            return

        #:DEPENDENT fallback 員工 inbox / email
        notify_user_id = user_id
        subject_user_id: str | None = None
        notify_user = user
        rendered_payload = dict(payload or {})

        if str(user.role) == "DEPENDENT":
            dep = await self.auth_svc.get_dependent_by_user_id(user_id)
            if dep is None:
                logger.warning(
                    "notification_dependent_no_employee_link", user_id=user_id, type=type
                )
                return
            #:auth_svc 提供 get_employee_for_dependent;不直接 import auth.models
            employee_user = await self.auth_svc.get_employee_for_dependent(dep.id)
            if employee_user is None:
                logger.warning("notification_employee_not_found", dep_id=dep.id)
                return
            notify_user_id = employee_user.id
            subject_user_id = user_id
            notify_user = employee_user
            rendered_payload["as_dependent_name"] = user.name
            rendered_payload["dependent_user_id"] = user_id

        rendered = render_notification(
            type=type,
            user={"name": notify_user.name, "email": notify_user.email},
            payload=rendered_payload,
        )

        created_ids: list[str] = []
        for ch in target_channels:
            body = rendered.body_email if ch == "EMAIL" else rendered.body_text
            if not body:
                logger.info("notification_channel_skipped_empty_body", type=type, channel=ch)
                continue
            n_id = generate_ulid()
            await self.repo.create(
                notification_id=n_id,
                user_id=notify_user_id,
                subject_user_id=subject_user_id,
                channel=ch,
                type=type,
                title=rendered.title,
                body=body,
                payload=rendered_payload,
            )
            created_ids.append(n_id)

        if created_ids:
            await audit(
                self.session,
                actor_id=None,
                actor_role="SYSTEM",
                action="notification.send",
                entity_type="notification",
                entity_id=created_ids[0] if len(created_ids) == 1 else type,
                after={
                    "user_id": notify_user_id,
                    "subject_user_id": subject_user_id,
                    "type": type,
                    "channels": list(target_channels),
                    "notification_ids": created_ids,
                },
            )

        await self.session.commit()

        for n_id in created_ids:
            await self._dispatch_one(n_id)

    async def send_batch(
        self,
        user_ids: list[str],
        type: str,
        channels: list[str] | None = None,
        payload_per_user: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        """批次發送(抽籤後通知所有員工);per-user 失敗不擋其他人。"""
        for uid in user_ids:
            try:
                await self.send(
                    user_id=uid,
                    type=type,
                    channels=channels,
                    payload=(payload_per_user or {}).get(uid),
                )
            except Exception:
                logger.exception("notification_send_batch_user_failed", user_id=uid, type=type)

    # Dispatcher

    async def _dispatch_one(self, notification_id: str) -> None:
        """單筆 dispatch;失敗直接 mark_failed,等下個 retry round"""
        n = await self.repo.get_by_id(notification_id)
        if n is None or n.status != "PENDING":
            return
        try:
            if n.channel == "EMAIL":
                await self._send_email(n)
            elif n.channel == "WEBSOCKET":
                await self._send_websocket(n)
            elif n.channel == "IN_APP":
                # 站內通知本身就是 INSERT 一筆紀錄,不需額外動作(設計 §11.6)
                pass
            await self.repo.mark_sent(notification_id)
            await self.session.commit()
        except Exception as e:
            logger.warning(
                "notification_dispatch_failed",
                notification_id=notification_id,
                channel=n.channel,
                error=str(e),
            )
            NOTIFICATION_SEND_FAILURES.labels(channel=n.channel).inc()
            await self.repo.mark_failed(notification_id, str(e))
            await self.session.commit()

    async def _send_email(self, n: NotificationORM) -> None:
        """經 SMTP(Mailpit / lab)送出。Mailpit 不需 auth,production 走企業 relay。

        :用 email.message.EmailMessage 自動處理 Subject 中文 RFC2047
        編碼 + header injection 防護(若 user.email 含 \\r\\n 會被拒)。
        """
        user = await self.auth_svc.get_user_by_id(str(n.user_id))
        if user is None:
            raise RuntimeError(f"user {n.user_id} 不存在")

        msg = EmailMessage()
        msg["From"] = settings.smtp_from_address
        msg["To"] = user.email
        msg["Subject"] = n.title # EmailMessage 自動處理中文 → RFC2047
        msg.add_alternative(n.body, subtype="html", charset="utf-8")

        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
            start_tls=settings.smtp_start_tls,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
        )

    async def _send_websocket(self, n: NotificationORM) -> None:
        """跨副本透 Redis Pub/Sub `user:{user_id}` 廣播;payload 加 HMAC 簽章
        防其他能 publish redis 的元件冒名推送()"""
        redis = get_redis()
        signed = sign_payload(
            {
                "type": "notification",
                "data": {
                    "id": str(n.id),
                    "type": str(n.type),
                    "title": str(n.title),
                    "body": str(n.body),
                    "payload": n.payload or {},
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                },
            }
        )
        await redis.publish(f"user:{n.user_id}", json.dumps(signed, ensure_ascii=False))

    # APScheduler retry job(設計 §11.7)

    async def retry_pending(self) -> int:
        """掃 PENDING 過了指數退避視窗的紀錄,重送對應 channel。回傳處理筆數。

        APScheduler 每 5 分鐘執行;呼叫 caller 應先取 advisory lock 防多副本並行
        (與 expire_overdue_won 同模式,registration jobs 有 helper)。
        """
        rows = await self.repo.find_pending_for_retry(
            max_retry=_RETRY_MAX, backoff_base_minutes=_RETRY_BACKOFF_BASE_MIN
        )
        if not rows:
            return 0
        processed = 0
        for n in rows:
            try:
                if n.channel == "EMAIL":
                    await self._send_email(n)
                elif n.channel == "WEBSOCKET":
                    await self._send_websocket(n)
                # IN_APP 不會進入 retry queue(create 時 channel='IN_APP' 一進就 mark_sent
                # 失敗只可能是 DB 問題,DB 失敗整個 transaction rollback 而非 mark_failed)
                await self.repo.mark_sent(str(n.id))
                processed += 1
            except Exception as e:
                logger.warning(
                    "notification_retry_failed",
                    notification_id=str(n.id),
                    channel=n.channel,
                    retry_count=n.retry_count,
                    error=str(e),
                )
                NOTIFICATION_SEND_FAILURES.labels(channel=n.channel).inc()
                if int(n.retry_count) + 1 >= _RETRY_MAX:
                    await self.repo.mark_failed_terminal(str(n.id), str(e))
                else:
                    await self.repo.mark_failed(str(n.id), str(e))
        await self.session.commit()
        logger.info("notification_retry_processed", processed=processed, total=len(rows))
        return processed

    # 站內讀取(API 用)

    async def list_in_app_notifications(
        self,
        user_id: str,
        *,
        unread_only: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> NotificationListResponse:
        """對齊設計 05 §12.1 — items 含 body/payload + 同次回傳 unread_count"""
        offset = (page - 1) * page_size
        rows, total = await self.repo.list_in_app_for_user(
            user_id, unread_only=unread_only, offset=offset, limit=page_size
        )
        unread = await self.repo.get_unread_in_app_count(user_id)
        items = [_to_item(r) for r in rows]
        return NotificationListResponse(
            items=items,
            total=total,
            unread_count=unread,
            page=page,
            page_size=page_size,
            has_next=(page * page_size) < total,
        )

    async def mark_read(self, notification_id: str, user_id: str) -> MarkReadResult:
        """標記已讀;notification 不存在或非該使用者 → NotFound(防越權探測)。
        對齊設計 05 §12.2 回傳 {id, read_at}(冪等:已讀也回該筆 read_at)"""
        ok = await self.repo.mark_read(notification_id, user_id)
        # 取最終 read_at(剛 update / 已讀都要回給前端)
        n = await self.repo.get_by_id(notification_id)
        if n is None or str(n.user_id) != user_id or n.channel != "IN_APP":
            raise NotificationNotFoundError("通知不存在")
        await self.session.commit()
        if n.read_at is None:
            # mark_read 失敗但 row 存在(極罕見:剛被別處清掉)— 視為 NotFound
            raise NotificationNotFoundError("通知不存在")
        _ = ok # rowcount 0/1 都 OK,read_at 已是最終值
        return MarkReadResult(id=str(n.id), read_at=n.read_at)

    async def mark_all_read(self, user_id: str) -> int:
        n = await self.repo.mark_all_read_for_user(user_id)
        await self.session.commit()
        return n

    async def get_unread_count(self, user_id: str) -> UnreadCount:
        c = await self.repo.get_unread_in_app_count(user_id)
        return UnreadCount(unread_count=c)


# DTO 轉換


def _to_item(orm: NotificationORM) -> NotificationItem:
    """對齊設計 05 §12.1 列表 item 形狀"""
    return NotificationItem(
        id=str(orm.id),
        type=str(orm.type),
        title=str(orm.title),
        body=str(orm.body),
        payload=dict(orm.payload or {}),
        read_at=orm.read_at,
        created_at=orm.created_at,
    )


__all__ = [
    "NOTIFICATION_CONFIG",
    "NotificationService",
    "NotificationServiceProtocol",
]
