"""event 模組 repository — 只此模組可直接存取 events / sessions / ticket_types 表"""

from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.core.ulid import generate_ulid
from app.modules.event.models import Event, Session, TicketType


class EventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, event_id: str) -> Event | None:
        result = await self.session.execute(select(Event).where(Event.id == event_id))
        return result.scalar_one_or_none()

    async def list_published_for_site(
        self,
        user_site: str,
        scope: str = "eligible",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Event], int]:
        """列出已發布活動。

        scope='eligible' 過濾廠區資格,'all' 不過濾;
        allowed_sites=[] 視同全廠區開放。
        回傳 (events_in_page, total_count)
        """
        offset = (page - 1) * page_size
        base = select(Event).where(Event.status == "PUBLISHED")
        if scope == "eligible":
            base = base.where(
                or_(
                    # 全廠區開放(空陣列)
                    Event.allowed_sites == [],
                    Event.allowed_sites.any(user_site),
                )
            )

        # 同 transaction 跑兩個 query:總數 + page 資料
        total_q = select(func.count()).select_from(base.subquery())
        total_result = await self.session.execute(total_q)
        total = int(total_result.scalar_one())

        page_q = base.order_by(Event.created_at.desc()).offset(offset).limit(page_size)
        page_result = await self.session.execute(page_q)
        events = list(page_result.scalars().all())
        return events, total

    async def list_admin(
        self,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Event], int]:
        """admin 用列表:可選 status filter(DRAFT / PUBLISHED / CANCELLED / None=全部)。

        :草稿管理用,不過濾廠區、含 PUBLISHED / CANCELLED / DRAFT 全狀態。
        order by created_at DESC 讓最新草稿在最上。
        """
        offset = (page - 1) * page_size
        base = select(Event)
        if status is not None:
            base = base.where(Event.status == status)

        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())

        page_q = base.order_by(Event.created_at.desc()).offset(offset).limit(page_size)
        events = list((await self.session.execute(page_q)).scalars().all())
        return events, total

    async def create(
        self,
        *,
        title: str,
        description: str | None,
        cover_image_url: str | None,
        allowed_sites: list[str],
        created_by: str,
    ) -> Event:
        now = now_utc()
        event = Event(
            id=generate_ulid(),
            title=title,
            description=description,
            cover_image_url=cover_image_url,
            status="DRAFT",
            allowed_sites=allowed_sites,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        self.session.add(event)
        await self.session.flush()
        return event

    # 白名單:防 update_fields 被傳任意 dict 覆蓋 id / created_at / created_by
    _ALLOWED_UPDATE_FIELDS: frozenset[str] = frozenset(
        {"title", "description", "cover_image_url", "allowed_sites"}
    )

    async def update_fields(self, event_id: str, fields: dict[str, Any]) -> Event | None:
        safe_fields = {k: v for k, v in fields.items() if k in self._ALLOWED_UPDATE_FIELDS}
        safe_fields["updated_at"] = now_utc()
        result = await self.session.execute(
            update(Event).where(Event.id == event_id).values(**safe_fields).returning(Event)
        )
        await self.session.flush()
        return result.scalar_one_or_none()

    async def set_status(
        self, event_id: str, status: str, cancelled_at: datetime | None = None
    ) -> Event | None:
        fields: dict[str, Any] = {"status": status, "updated_at": now_utc()}
        if cancelled_at is not None:
            fields["cancelled_at"] = cancelled_at
        result = await self.session.execute(
            update(Event).where(Event.id == event_id).values(**fields).returning(Event)
        )
        await self.session.flush()
        return result.scalar_one_or_none()

    async def list_archive_candidate_ids(self, older_than: datetime) -> list[str]:
        """ Batch B(A3):archive 候選查詢(設計 04 §8.2)。

        條件 union:
        1. events.cancelled_at < older_than(已取消逾保留期)
        2. event 全部 sessions max(ends_at) < older_than(全部場次結束逾保留期)

        回傳去重後排序的 event_id list,caller 自行批次處理。lab 期間 archive job
        不做 DELETE,所以同一批 ID 每月會被重抓 — 上傳時走冪等 PUT(同 key 覆寫)。
        """
        cancelled_q = select(Event.id).where(
            and_(Event.cancelled_at.isnot(None), Event.cancelled_at < older_than)
        )
        ended_q = (
            select(Event.id)
            .join(Session, Session.event_id == Event.id)
            .group_by(Event.id)
            .having(func.max(Session.ends_at) < older_than)
        )
        ids: set[str] = set()
        for q in (cancelled_q, ended_q):
            result = await self.session.execute(q)
            for row in result.scalars().all():
                ids.add(str(row))
        return sorted(ids)


class SessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, session_id: str) -> Session | None:
        result = await self.session.execute(select(Session).where(Session.id == session_id))
        return result.scalar_one_or_none()

    async def list_by_event(self, event_id: str) -> list[Session]:
        result = await self.session.execute(
            select(Session).where(Session.event_id == event_id).order_by(Session.starts_at)
        )
        return list(result.scalars().all())

    async def list_starting_in_window(self, after: datetime, before: datetime) -> list[Session]:
        """.1:event_reminder_scan 用 — starts_at 在 (after, before] 區間,
        且場次仍可入場(status 不為 CLOSED / CANCELLED)"""
        result = await self.session.execute(
            select(Session)
            .where(
                and_(
                    Session.starts_at > after,
                    Session.starts_at <= before,
                    Session.status.notin_(["CLOSED", "CANCELLED"]),
                )
            )
            .order_by(Session.starts_at)
        )
        return list(result.scalars().all())

    async def list_lottery_pending(self) -> list[Session]:
        """已過抽籤時間 + REGISTRATION_CLOSED + 未抽過(對齊 idx_sessions_lottery_pending)"""
        result = await self.session.execute(
            select(Session).where(
                and_(
                    Session.status == "REGISTRATION_CLOSED",
                    Session.lottery_executed_at.is_(None),
                    Session.lottery_at <= now_utc(),
                )
            )
        )
        return list(result.scalars().all())

    async def create(
        self,
        *,
        event_id: str,
        title: str,
        venue: str,
        starts_at: datetime,
        ends_at: datetime,
        registration_opens_at: datetime,
        registration_closes_at: datetime,
        lottery_at: datetime,
        waitlist_close_at: datetime,
        confirmation_deadline_hours: int = 48,
    ) -> Session:
        now = now_utc()
        sess = Session(
            id=generate_ulid(),
            event_id=event_id,
            title=title,
            venue=venue,
            starts_at=starts_at,
            ends_at=ends_at,
            registration_opens_at=registration_opens_at,
            registration_closes_at=registration_closes_at,
            lottery_at=lottery_at,
            waitlist_close_at=waitlist_close_at,
            confirmation_deadline_hours=confirmation_deadline_hours,
            status="REGISTRATION_OPEN",
            created_at=now,
            updated_at=now,
        )
        self.session.add(sess)
        await self.session.flush()
        return sess

    async def set_status(
        self,
        session_id: str,
        status: str,
        lottery_executed_at: datetime | None = None,
    ) -> Session | None:
        fields: dict[str, Any] = {"status": status, "updated_at": now_utc()}
        if lottery_executed_at is not None:
            fields["lottery_executed_at"] = lottery_executed_at
        result = await self.session.execute(
            update(Session).where(Session.id == session_id).values(**fields).returning(Session)
        )
        await self.session.flush()
        return result.scalar_one_or_none()

    # 白名單:防 update_fields 被傳任意 dict 覆蓋 id / event_id / 內部時間戳記
    _ALLOWED_UPDATE_FIELDS: frozenset[str] = frozenset(
        {
            "title",
            "venue",
            "starts_at",
            "ends_at",
            "registration_opens_at",
            "registration_closes_at",
            "lottery_at",
            "waitlist_close_at",
            "confirmation_deadline_hours",
            "status",
        }
    )

    async def update_fields(
        self,
        session_id: str,
        fields: dict[str, Any],
        *,
        expected_status: str | None = None,
    ) -> Session | None:
        """白名單欄位更新;`chk_sessions_time_order` 由 DB CHECK 把關。

        若傳 `expected_status`,UPDATE 加 `WHERE status=:expected_status` 守衛
        (CAS 樂觀鎖):race 場景下若 status 已被排程任務改成 LOTTERY_RUNNING /
        LOTTERY_COMPLETED 等,UPDATE 影響 0 列回 None,caller 應 raise
        InvalidEventStateError(避免 admin PATCH 覆蓋 lottery-runner 已寫的狀態)。
        """
        safe_fields = {k: v for k, v in fields.items() if k in self._ALLOWED_UPDATE_FIELDS}
        if not safe_fields:
            return await self.get_by_id(session_id)
        safe_fields["updated_at"] = now_utc()
        stmt = update(Session).where(Session.id == session_id)
        if expected_status is not None:
            stmt = stmt.where(Session.status == expected_status)
        result = await self.session.execute(stmt.values(**safe_fields).returning(Session))
        await self.session.flush()
        return result.scalar_one_or_none()


class TicketTypeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, ticket_type_id: str) -> TicketType | None:
        result = await self.session.execute(
            select(TicketType).where(TicketType.id == ticket_type_id)
        )
        return result.scalar_one_or_none()

    async def list_by_session(self, session_id: str) -> list[TicketType]:
        result = await self.session.execute(
            select(TicketType)
            .where(TicketType.session_id == session_id)
            .order_by(TicketType.sort_order, TicketType.created_at)
        )
        return list(result.scalars().all())

    async def create(
        self,
        *,
        session_id: str,
        name: str,
        quota: int,
        sort_order: int = 0,
        audience: str = "EMPLOYEE",
    ) -> TicketType:
        now = now_utc()
        tt = TicketType(
            id=generate_ulid(),
            session_id=session_id,
            name=name,
            quota=quota,
            sort_order=sort_order,
            audience=audience,
            created_at=now,
            updated_at=now,
        )
        self.session.add(tt)
        await self.session.flush()
        return tt

    async def find_dependent_by_session(self, session_id: str) -> TicketType | None:
        """:每 session 最多 1 個 audience='DEPENDENT' ticket_type;
        partial UNIQUE 在 0010 加。service 層先 check 給 admin 友善錯誤訊息。
        """
        result = await self.session.execute(
            select(TicketType)
            .where(TicketType.session_id == session_id)
            .where(TicketType.audience == "DEPENDENT")
        )
        return result.scalar_one_or_none()
