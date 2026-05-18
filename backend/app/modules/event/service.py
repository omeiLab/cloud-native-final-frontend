"""event 模組 Service — admin CRUD + employee 列表 + 跨模組查詢介面

對齊設計 06 §7。提供 EventServiceProtocol 抽象,讓 起的
registration / lottery / ticket / admin 模組透過 Protocol 注入。
"""

from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.logging import get_logger
from app.core.time import now_utc
from app.modules.auth.dependencies import require_service_actor
from app.modules.event import cache as event_cache
from app.modules.event.errors import (
    CannotModifyPublishedFieldError,
    EventNotFoundError,
    IneligibleError,
    InvalidEventStateError,
    SessionNotFoundError,
)
from app.modules.event.models import Event, Session, TicketType
from app.modules.event.repository import (
    EventRepository,
    SessionRepository,
    TicketTypeRepository,
)
from app.shared.enums import EligibilityReason, EventStatus, SessionStatus
from app.shared.event_ref import (
    EligibilityResult,
    EventDetail,
    EventSummary,
    SessionInfo,
    TicketTypeInfo,
)

logger = get_logger(__name__)


@runtime_checkable
class EventServiceProtocol(Protocol):
    """跨模組呼叫介面(設計 06 §7.3)"""

    async def get_session_for_eligibility_check(self, session_id: str) -> SessionInfo | None:...

    async def check_eligibility(self, user_site: str, session_id: str) -> EligibilityResult:...

    async def get_session(self, session_id: str) -> SessionInfo | None:...

    async def list_sessions_for_lottery(self) -> list[SessionInfo]:...

    async def list_sessions_starting_in_window(
        self, after: "datetime", before: "datetime"
    ) -> list[SessionInfo]:
        """.1:event_reminder_scan 用 — starts_at 在 (after, before] 區間"""
        ...

    async def mark_lottery_running(self, session_id: str) -> None:...

    async def mark_lottery_completed(self, session_id: str) -> None:...

    async def get_event(self, event_id: str) -> EventDetail | None:...

    async def get_ticket_type(self, ticket_type_id: str) -> TicketTypeInfo | None:...

    async def list_archive_candidate_ids(self, older_than: datetime) -> list[str]:
        """ Batch B(A3):拉 archive 候選 event_id list(設計 04 §8.2)"""
        ...

    async def cancel_event(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        reason: str | None = None,
        request_id: str | None = None,
    ) -> EventDetail:
        """ 全修:admin layer 呼叫此方法,標 status=CANCELLED + audit。
        撤銷票券與通知由 admin_svc.cancel_event 後續呼叫 ticket_svc 完成。
        """
        ...


class EventService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.event_repo = EventRepository(session)
        self.session_repo = SessionRepository(session)
        self.ticket_type_repo = TicketTypeRepository(session)

    # 跨模組查詢介面

    async def get_session_for_eligibility_check(self, session_id: str) -> SessionInfo | None:
        # cache 先看;命中省一次 DB 查詢(register flow 熱徑)
        cached = await event_cache.get_session(session_id)
        if cached is not None:
            return cached
        sess = await self.session_repo.get_by_id(session_id)
        if sess is None:
            return None
        info = await self._session_to_info(sess)
        await event_cache.set_session(session_id, info)
        return info

    async def get_session(self, session_id: str) -> SessionInfo | None:
        return await self.get_session_for_eligibility_check(session_id)

    async def list_sessions_for_lottery(self) -> list[SessionInfo]:
        sessions = await self.session_repo.list_lottery_pending()
        return [await self._session_to_info(s) for s in sessions]

    async def list_sessions_starting_in_window(
        self, after: datetime, before: datetime
    ) -> list[SessionInfo]:
        """.1:event_reminder_scan 用"""
        sessions = await self.session_repo.list_starting_in_window(after, before)
        return [await self._session_to_info(s) for s in sessions]

    async def mark_lottery_running(self, session_id: str) -> None:
        await self.session_repo.set_status(session_id, "LOTTERY_RUNNING")
        await self.session.commit()

    async def mark_lottery_completed(self, session_id: str) -> None:
        await self.session_repo.set_status(
            session_id, "LOTTERY_COMPLETED", lottery_executed_at=now_utc()
        )
        await self.session.commit()

    async def get_event(self, event_id: str) -> EventDetail | None:
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            return None
        return await self._event_to_detail(event)

    async def get_ticket_type(self, ticket_type_id: str) -> TicketTypeInfo | None:
        tt = await self.ticket_type_repo.get_by_id(ticket_type_id)
        if tt is None:
            return None
        return _ticket_type_to_info(tt)

    async def list_archive_candidate_ids(self, older_than: datetime) -> list[str]:
        """ Batch B(A3):拉 archive 候選的 event_id(設計 04 §8.2)。

        傳給 admin archive job;EventService 持有此查詢是因為 要求
        admin 不可直接讀 events repo / models。
        """
        return await self.event_repo.list_archive_candidate_ids(older_than)

    async def check_eligibility(self, user_site: str, session_id: str) -> EligibilityResult:
        """檢查員工廠區是否符合場次資格 + 場次是否在報名期間"""
        sess = await self.session_repo.get_by_id(session_id)
        if sess is None:
            raise SessionNotFoundError("場次不存在")
        event = await self.event_repo.get_by_id(sess.event_id)
        if event is None or event.status != "PUBLISHED":
            raise EventNotFoundError("活動不存在或未發布")

        # 廠區檢查:空 allowed_sites 視同全廠區開放(設計 §4.2)
        allowed_sites = list(event.allowed_sites)
        if allowed_sites and user_site not in allowed_sites:
            return EligibilityResult(
                eligible=False,
                reason=f"本活動僅限 {', '.join(allowed_sites)} 廠區員工報名",
                reason_code=EligibilityReason.SITE_MISMATCH,
                user_site=user_site,
                allowed_sites=allowed_sites,
                session_status=SessionStatus(sess.status),
            )

        # 報名期間檢查
        now = now_utc()
        if sess.status != "REGISTRATION_OPEN":
            return EligibilityResult(
                eligible=False,
                reason=f"場次狀態為 {sess.status},不可報名",
                reason_code=EligibilityReason.SESSION_NOT_OPEN,
                user_site=user_site,
                allowed_sites=allowed_sites,
                session_status=SessionStatus(sess.status),
            )
        if now < sess.registration_opens_at:
            return EligibilityResult(
                eligible=False,
                reason="報名尚未開放",
                reason_code=EligibilityReason.REGISTRATION_NOT_YET_OPEN,
                user_site=user_site,
                allowed_sites=allowed_sites,
                session_status=SessionStatus(sess.status),
            )
        if now >= sess.registration_closes_at:
            return EligibilityResult(
                eligible=False,
                reason="報名已截止",
                reason_code=EligibilityReason.REGISTRATION_CLOSED,
                user_site=user_site,
                allowed_sites=allowed_sites,
                session_status=SessionStatus(sess.status),
            )

        return EligibilityResult(
            eligible=True,
            user_site=user_site,
            allowed_sites=allowed_sites,
            session_status=SessionStatus(sess.status),
        )

    # Employee 端

    async def list_published_for_employee(
        self,
        user_site: str,
        scope: str = "eligible",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[EventSummary], int]:
        events, total = await self.event_repo.list_published_for_site(
            user_site, scope, page, page_size
        )
        summaries: list[EventSummary] = []
        for ev in events:
            sessions = await self.session_repo.list_by_event(ev.id)
            first_session = sessions[0] if sessions else None
            allowed = list(ev.allowed_sites)
            # is_eligible:廠區符合(空陣列視同全開放)
            is_eligible = not allowed or user_site in allowed
            summaries.append(
                EventSummary(
                    id=ev.id,
                    title=ev.title,
                    cover_image_url=ev.cover_image_url,
                    status=EventStatus(ev.status),
                    allowed_sites=allowed,
                    starts_at=first_session.starts_at if first_session else None,
                    venue=first_session.venue if first_session else None,
                    remaining_quota=0, # 起 registration 可算實際剩餘
                    session_count=len(sessions),
                    is_eligible=is_eligible,
                )
            )
        return summaries, total

    async def get_event_detail_for_employee(
        self, event_id: str, user_site: str
    ) -> EventDetail | None:
        # cache 先看
        cached = await event_cache.get_event_detail(event_id)
        if cached is not None:
            if cached.status != EventStatus.PUBLISHED:
                return None
            allowed = list(cached.allowed_sites)
            if allowed and user_site not in allowed:
                raise IneligibleError(f"本活動僅限 {', '.join(allowed)} 廠區員工報名")
            return cached

        event = await self.event_repo.get_by_id(event_id)
        if event is None or event.status != "PUBLISHED":
            return None
        # 廠區資格 — 不符直接 401(IneligibleError)
        allowed = list(event.allowed_sites)
        if allowed and user_site not in allowed:
            raise IneligibleError(f"本活動僅限 {', '.join(allowed)} 廠區員工報名")
        detail = await self._event_to_detail(event)
        await event_cache.set_event_detail(event_id, detail)
        return detail

    # Admin 端

    async def list_for_admin(
        self,
        *,
        actor_role: str,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[EventSummary], int]:
        """admin 列活動:可選 status filter(DRAFT / PUBLISHED / CANCELLED / None=全部)。

        :草稿管理 — 跟 employee 列表的差異:
        - 不過濾廠區資格(admin 看全部)
        - 支援 status filter(主要給「列出草稿」用)
        - 不算 is_eligible(admin 不需要)
        """
        require_service_actor(actor_role, {"ADMIN"})
        events, total = await self.event_repo.list_admin(
            status=status, page=page, page_size=page_size
        )
        summaries: list[EventSummary] = []
        for ev in events:
            sessions = await self.session_repo.list_by_event(ev.id)
            first_session = sessions[0] if sessions else None
            summaries.append(
                EventSummary(
                    id=ev.id,
                    title=ev.title,
                    cover_image_url=ev.cover_image_url,
                    status=EventStatus(ev.status),
                    allowed_sites=list(ev.allowed_sites),
                    starts_at=first_session.starts_at if first_session else None,
                    venue=first_session.venue if first_session else None,
                    remaining_quota=0,
                    session_count=len(sessions),
                    is_eligible=True, # admin 視角無 ineligible 概念
                )
            )
        return summaries, total

    async def get_event_detail_for_admin(
        self, event_id: str, *, actor_role: str
    ) -> EventDetail | None:
        """admin 看 event detail — 不限 status(DRAFT / PUBLISHED / CANCELLED 都看)。

        :草稿管理用。不走 event_cache(避免 DRAFT 被快取後 employee 路徑誤命中)。
        """
        require_service_actor(actor_role, {"ADMIN"})
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            return None
        return await self._event_to_detail(event)

    async def create_event(
        self,
        *,
        actor_id: str,
        actor_role: str,
        title: str,
        description: str | None,
        cover_image_url: str | None,
        allowed_sites: list[str],
        request_id: str | None = None,
    ) -> EventDetail:
        # service 層 RBAC 守衛
        require_service_actor(actor_role, {"ADMIN"})
        event = await self.event_repo.create(
            title=title,
            description=description,
            cover_image_url=cover_image_url,
            allowed_sites=allowed_sites,
            created_by=actor_id,
        )
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="event.create",
            entity_type="event",
            entity_id=event.id,
            after={
                "title": title,
                "allowed_sites": allowed_sites,
                "status": "DRAFT",
            },
            request_id=request_id,
        )
        await self.session.commit()
        return await self._event_to_detail(event)

    async def update_event(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        fields: dict[str, Any],
        request_id: str | None = None,
    ) -> EventDetail:
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            raise EventNotFoundError("活動不存在")

        # BR-11:活動發布後 allowed_sites 不可改
        if event.status == "PUBLISHED" and "allowed_sites" in fields:
            raise CannotModifyPublishedFieldError("活動發布後 allowed_sites 不可修改")

        before = {
            "title": event.title,
            "description": event.description,
            "allowed_sites": list(event.allowed_sites),
        }
        updated = await self.event_repo.update_fields(event_id, fields)
        if updated is None:
            raise EventNotFoundError("活動不存在")
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="event.update",
            entity_type="event",
            entity_id=event_id,
            before=before,
            after=fields,
            request_id=request_id,
        )
        await self.session.commit()
        await event_cache.evict_event(event_id)
        return await self._event_to_detail(updated)

    async def publish_event(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        request_id: str | None = None,
    ) -> EventDetail:
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            raise EventNotFoundError("活動不存在")
        if event.status != "DRAFT":
            raise InvalidEventStateError(f"活動狀態為 {event.status},只有 DRAFT 才能發布")

        sessions = await self.session_repo.list_by_event(event_id)
        if not sessions:
            raise InvalidEventStateError("發布前必須至少有一個場次")

        updated = await self.event_repo.set_status(event_id, "PUBLISHED")
        if updated is None:
            raise EventNotFoundError("活動不存在")
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="event.publish",
            entity_type="event",
            entity_id=event_id,
            before={"status": "DRAFT"},
            after={"status": "PUBLISHED"},
            request_id=request_id,
        )
        await self.session.commit()
        await event_cache.evict_event(event_id)
        return await self._event_to_detail(updated)

    async def cancel_event(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        reason: str | None = None,
        request_id: str | None = None,
    ) -> EventDetail:
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            raise EventNotFoundError("活動不存在")
        if event.status == "CANCELLED":
            raise InvalidEventStateError("活動已取消")
        before_status = event.status
        updated = await self.event_repo.set_status(event_id, "CANCELLED", cancelled_at=now_utc())
        if updated is None:
            raise EventNotFoundError("活動不存在")
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="event.cancel",
            entity_type="event",
            entity_id=event_id,
            before={"status": before_status},
            after={"status": "CANCELLED", "reason": reason},
            request_id=request_id,
        )
        await self.session.commit()
        await event_cache.evict_event(event_id)
        # 票券撤銷與 EventCancelled 事件 publish 由 admin_svc.cancel_event 後續
        # 呼叫 ticket_svc.revoke_tickets_by_event_cancelled 完成
        # (layer:event 不能 import ticket,協調放在 admin 層)
        return await self._event_to_detail(updated)

    async def add_session(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        title: str,
        venue: str,
        starts_at: datetime,
        ends_at: datetime,
        registration_opens_at: datetime,
        registration_closes_at: datetime,
        lottery_at: datetime,
        waitlist_close_at: datetime,
        confirmation_deadline_hours: int = 48,
        request_id: str | None = None,
    ) -> SessionInfo:
        event = await self.event_repo.get_by_id(event_id)
        if event is None:
            raise EventNotFoundError("活動不存在")
        sess = await self.session_repo.create(
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
        )
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="session.create",
            entity_type="session",
            entity_id=sess.id,
            after={"event_id": event_id, "title": title, "starts_at": starts_at.isoformat()},
            request_id=request_id,
        )
        await self.session.commit()
        # session 變動會影響 event detail(sessions 列表)
        await event_cache.evict_event(event_id)
        return await self._session_to_info(sess)

    async def update_session(
        self,
        *,
        session_id: str,
        actor_id: str,
        actor_role: str,
        fields: dict[str, Any],
        request_id: str | None = None,
    ) -> SessionInfo:
        """更新場次欄位(設計 §7.2 admin):時間調整 / 提前關閉報名。

        `chk_sessions_time_order` 由 DB CHECK 強制;status 限定為手動關閉報名。
        寫完後 evict session + event cache,避免 60 秒 TTL 內驗票時段判斷誤用
        舊值(對齊 §10.7 BR-07 票券核銷時窗)。
        """
        sess = await self.session_repo.get_by_id(session_id)
        if sess is None:
            raise SessionNotFoundError("場次不存在")

        # status 改只允許 REGISTRATION_OPEN → REGISTRATION_CLOSED;UPDATE 帶
        # expected_status 守衛防 TOCTOU race(lottery-runner 同時寫
        # LOTTERY_RUNNING / LOTTERY_COMPLETED 時不可被 admin PATCH 覆蓋回去)。
        expected: str | None = None
        if "status" in fields:
            if sess.status != "REGISTRATION_OPEN":
                raise InvalidEventStateError(
                    f"場次狀態為 {sess.status},僅 REGISTRATION_OPEN 可手動關閉報名"
                )
            expected = "REGISTRATION_OPEN"

        before_raw: dict[str, Any] = {k: getattr(sess, k, None) for k in fields}
        updated = await self.session_repo.update_fields(
            session_id, fields, expected_status=expected
        )
        if updated is None:
            # expected_status 不為 None 而 UPDATE 影響 0 列 → race 中被別人寫掉了
            if expected is not None:
                raise InvalidEventStateError(
                    "場次狀態已被其他流程變更(可能 lottery-runner 已開始抽籤),請重新讀取後再操作"
                )
            raise SessionNotFoundError("場次不存在")

        def _ser(v: Any) -> Any:
            return v.isoformat() if hasattr(v, "isoformat") else v

        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="session.update",
            entity_type="session",
            entity_id=session_id,
            before={k: _ser(v) for k, v in before_raw.items()},
            after={k: _ser(v) for k, v in fields.items()},
            request_id=request_id,
        )
        await self.session.commit()
        # session detail + event detail 都要 evict;避免驗票讀到舊 starts_at
        await event_cache.evict_session(session_id)
        await event_cache.evict_event(updated.event_id)
        return await self._session_to_info(updated)

    async def add_ticket_type(
        self,
        *,
        session_id: str,
        actor_id: str,
        actor_role: str,
        name: str,
        quota: int,
        sort_order: int = 0,
        audience: str = "EMPLOYEE",
        request_id: str | None = None,
    ) -> TicketTypeInfo:
        # service 層 RBAC
        require_service_actor(actor_role, {"ADMIN"})
        sess = await self.session_repo.get_by_id(session_id)
        if sess is None:
            raise SessionNotFoundError("場次不存在")
        # 層 1:LOTTERY_RUNNING/COMPLETED 後不可加 ticket_type
        if sess.status not in ("REGISTRATION_OPEN", "REGISTRATION_CLOSED"):
            raise InvalidEventStateError(f"場次狀態 {sess.status} 不可新增票種(抽籤已進行)")
        #:每場 1 個 audience='DEPENDENT' ticket_type 限制(service 層先檢)
        if audience == "DEPENDENT":
            existing = await self.ticket_type_repo.find_dependent_by_session(session_id)
            if existing is not None:
                raise InvalidEventStateError(
                    f"場次已有 audience=DEPENDENT 票種({existing.id});每場次最多 1 個"
                )
        tt = await self.ticket_type_repo.create(
            session_id=session_id,
            name=name,
            quota=quota,
            sort_order=sort_order,
            audience=audience,
        )
        await audit(
            self.session,
            actor_id=actor_id,
            actor_role=actor_role,
            action="ticket_type.create",
            entity_type="ticket_type",
            entity_id=tt.id,
            after={
                "session_id": session_id,
                "name": name,
                "quota": quota,
                "audience": audience,
            },
            request_id=request_id,
        )
        await self.session.commit()
        # ticket_type 變動會影響 event detail(透過 session ticket_types)
        await event_cache.evict_session(session_id)
        await event_cache.evict_event(sess.event_id)
        return _ticket_type_to_info(tt)

    # Internal helpers

    async def _event_to_detail(self, event: Event) -> EventDetail:
        sessions = await self.session_repo.list_by_event(event.id)
        return EventDetail(
            id=event.id,
            title=event.title,
            description=event.description,
            cover_image_url=event.cover_image_url,
            status=EventStatus(event.status),
            allowed_sites=list(event.allowed_sites),
            created_by=event.created_by,
            created_at=event.created_at,
            updated_at=event.updated_at,
            cancelled_at=event.cancelled_at,
            sessions=[await self._session_to_info(s) for s in sessions],
        )

    async def _session_to_info(self, sess: Session) -> SessionInfo:
        # 場次的 allowed_sites 沿用 event(讓 registration / lottery 不用 join)
        event = await self.event_repo.get_by_id(sess.event_id)
        allowed = list(event.allowed_sites) if event else []
        ticket_types = await self.ticket_type_repo.list_by_session(sess.id)
        return SessionInfo(
            id=sess.id,
            event_id=sess.event_id,
            title=sess.title,
            venue=sess.venue,
            starts_at=sess.starts_at,
            ends_at=sess.ends_at,
            registration_opens_at=sess.registration_opens_at,
            registration_closes_at=sess.registration_closes_at,
            lottery_at=sess.lottery_at,
            waitlist_close_at=sess.waitlist_close_at,
            confirmation_deadline_hours=sess.confirmation_deadline_hours,
            status=SessionStatus(sess.status),
            lottery_executed_at=sess.lottery_executed_at,
            allowed_sites=allowed,
            ticket_types=[_ticket_type_to_info(tt) for tt in ticket_types],
        )


def _ticket_type_to_info(tt: TicketType) -> TicketTypeInfo:
    return TicketTypeInfo(
        id=tt.id,
        session_id=tt.session_id,
        name=tt.name,
        quota=tt.quota,
        sort_order=tt.sort_order,
        audience=str(tt.audience or "EMPLOYEE"),
    )
