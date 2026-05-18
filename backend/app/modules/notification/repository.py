"""notification 模組 repository — 只此模組可直接存取 notifications 表"""

from datetime import timedelta
from typing import Any

from sqlalchemy import and_, delete, desc, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.modules.notification.models import Notification


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        notification_id: str,
        user_id: str,
        channel: str,
        type: str,
        title: str,
        body: str,
        payload: dict[str, Any] | None = None,
        subject_user_id: str | None = None,
    ) -> Notification:
        """:支援 subject_user_id(若 != user_id 表示員工為眷屬代收通知)"""
        now = now_utc()
        n = Notification(
            id=notification_id,
            user_id=user_id,
            subject_user_id=subject_user_id,
            channel=channel,
            type=type,
            title=title,
            body=body,
            payload=payload or {},
            status="PENDING",
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
        self.session.add(n)
        await self.session.flush()
        return n

    async def get_by_id(self, notification_id: str) -> Notification | None:
        result = await self.session.execute(
            select(Notification).where(Notification.id == notification_id)
        )
        return result.scalar_one_or_none()

    async def list_in_app_for_user(
        self,
        user_id: str,
        *,
        unread_only: bool = False,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Notification], int]:
        """站內通知中心(命中 idx_notifications_inapp_user partial index)"""
        base = select(Notification).where(
            and_(Notification.user_id == user_id, Notification.channel == "IN_APP")
        )
        if unread_only:
            base = base.where(Notification.read_at.is_(None))
        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())
        page_q = base.order_by(desc(Notification.created_at)).offset(offset).limit(limit)
        rows = list((await self.session.execute(page_q)).scalars().all())
        return rows, total

    async def get_unread_in_app_count(self, user_id: str) -> int:
        result = await self.session.execute(
            select(func.count(Notification.id)).where(
                and_(
                    Notification.user_id == user_id,
                    Notification.channel == "IN_APP",
                    Notification.read_at.is_(None),
                )
            )
        )
        return int(result.scalar_one())

    async def mark_sent(self, notification_id: str) -> None:
        now = now_utc()
        await self.session.execute(
            update(Notification)
            .where(Notification.id == notification_id)
            .values(status="SENT", sent_at=now, updated_at=now, last_error=None)
        )

    async def mark_failed(self, notification_id: str, error: str) -> None:
        """單筆失敗;retry_count + 1 (caller 透過 retry_pending 才會看 retry 上限)"""
        now = now_utc()
        await self.session.execute(
            update(Notification)
            .where(Notification.id == notification_id)
            .values(
                status="PENDING", # 仍 PENDING 等下次 retry
                last_error=error[:1000], # last_error TEXT,但截一下避免異常 stack 過大
                retry_count=Notification.retry_count + 1,
                updated_at=now,
            )
        )

    async def mark_failed_terminal(self, notification_id: str, error: str) -> None:
        """retry 達上限 → 改 FAILED(設計 06 §11.7)"""
        now = now_utc()
        await self.session.execute(
            update(Notification)
            .where(Notification.id == notification_id)
            .values(status="FAILED", last_error=error[:1000], updated_at=now)
        )

    async def mark_read(self, notification_id: str, user_id: str) -> bool:
        """標記已讀 — 必須匹配 user_id 防越權;回傳是否實際更新一筆。
        對已讀的 notification 為冪等(read_at IS NULL 限制不再 update)。"""
        now = now_utc()
        result = await self.session.execute(
            update(Notification)
            .where(
                and_(
                    Notification.id == notification_id,
                    Notification.user_id == user_id,
                    Notification.channel == "IN_APP",
                    Notification.read_at.is_(None),
                )
            )
            .values(read_at=now, updated_at=now)
        )
        return int(getattr(result, "rowcount", 0) or 0) > 0

    async def mark_all_read_for_user(self, user_id: str) -> int:
        now = now_utc()
        result = await self.session.execute(
            update(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.channel == "IN_APP",
                    Notification.read_at.is_(None),
                )
            )
            .values(read_at=now, updated_at=now)
        )
        return int(getattr(result, "rowcount", 0) or 0)

    async def has_recent_for_user(
        self,
        user_id: str,
        type: str,
        *,
        within_hours: int,
        payload_session_id: str | None = None,
    ) -> bool:
        """.1 dedup helper:同 user + type 在最近 within_hours 內是否已建立?
        若 payload_session_id 給,額外比對 payload->>session_id JSONB 欄位。
        命中 idx_notifications_inapp_user(user_id, created_at DESC,channel='IN_APP')。
        """
        cutoff = now_utc() - timedelta(hours=within_hours)
        conds = [
            Notification.user_id == user_id,
            Notification.type == type,
            Notification.created_at >= cutoff,
        ]
        if payload_session_id is not None:
            # payload JSONB → 用 ->> 文字提取比對
            conds.append(
                text("notifications.payload->>'session_id' =:sid").bindparams(
                    sid=payload_session_id
                )
            )
        result = await self.session.execute(
            select(func.count(Notification.id)).where(and_(*conds)).limit(1)
        )
        return int(result.scalar_one() or 0) > 0

    async def find_pending_for_retry(
        self,
        *,
        max_retry: int = 3,
        backoff_base_minutes: int = 5,
        limit: int = 100,
    ) -> list[Notification]:
        """掃 PENDING 且過了指數退避視窗的紀錄(設計 06 §11.7)。

        backoff:第 1 次失敗後 5 分鐘、第 2 次 10、第 3 次 15。
        WHERE status='PENDING' AND retry_count < 3
        AND created_at < NOW() - 5min * (retry_count + 1)
        命中 idx_notifications_pending partial index。

        :用 make_interval bind-param 替代 f-string,維持
        參數化一致性(`backoff_base_minutes` 雖內部常數但偏離 codebase 慣例)。
        """
        result = await self.session.execute(
            select(Notification)
            .where(
                and_(
                    Notification.status == "PENDING",
                    Notification.retry_count < max_retry,
                    text(
                        "notifications.created_at < NOW() - "
                        "make_interval(mins =>:base_min) "
                        "* (notifications.retry_count + 1)"
                    ).bindparams(base_min=backoff_base_minutes),
                )
            )
            .order_by(Notification.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def delete_old(self, older_than_days: int = 90, unread_grace_days: int = 180) -> int:
        """設計 04 §8.3 留 90 天; 後條件收窄:
        - 已讀 + read_at < 90d → 刪
        - 未讀 + created_at < 180d → 刪(避免誤刪未讀但很舊的通知)
        """
        read_cutoff = now_utc() - timedelta(days=older_than_days)
        unread_cutoff = now_utc() - timedelta(days=unread_grace_days)
        result = await self.session.execute(
            delete(Notification).where(
                or_(
                    # 已讀 + read_at 過 read_cutoff
                    and_(Notification.read_at.is_not(None), Notification.read_at < read_cutoff),
                    # 未讀 + created_at 過 unread_cutoff
                    and_(Notification.read_at.is_(None), Notification.created_at < unread_cutoff),
                )
            )
        )
        return int(getattr(result, "rowcount", 0) or 0)
