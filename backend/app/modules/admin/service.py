"""admin 模組 Service — 跨模組聚合 / 報名清單 / 廠區人數預覽(設計 06 §12)。

關鍵設計原則(§12.5):admin 沒有自己的 repository,所有資料透過其他模組
的 *ServiceProtocol 拉取。報表匯出與儀表板的資料聚合都在 service 層完成。
"""

from collections import defaultdict
from datetime import date, datetime

from app.core.logging import get_logger
from app.modules.admin.errors import EventNotFoundError, ExportTooLargeError
from app.modules.admin.pii import mask_employee_id, mask_name
from app.modules.auth.service import AuthServiceProtocol
from app.modules.event.service import EventServiceProtocol
from app.modules.lottery.service import LotteryServiceProtocol
from app.modules.registration.service import RegistrationServiceProtocol
from app.modules.ticket.service import TicketServiceProtocol
from app.shared.admin_ref import (
    AttendanceSummary,
    DashboardData,
    LotteryStatusInfo,
    RegistrationUserView,
    RegistrationWithUser,
    SiteCount,
    SiteEmployeeCount,
    TicketTypeProgress,
    TimelinePoint,
)
from app.shared.event_ref import EventDetail
from app.shared.pagination import PagedResult

logger = get_logger(__name__).bind(component="admin")


class AdminService:
    """純聚合 — 不建構 repository,只注入下游模組 Service Protocol(§12.5)"""

    #:export 同步上限(設計 06 §12.6 < 5000)— 超過拋 ExportTooLargeError
    EXPORT_SYNC_LIMIT = 5000

    def __init__(
        self,
        event_svc: EventServiceProtocol,
        registration_svc: RegistrationServiceProtocol,
        ticket_svc: TicketServiceProtocol,
        auth_svc: AuthServiceProtocol,
        lottery_svc: LotteryServiceProtocol | None = None,
    ) -> None:
        self.event_svc = event_svc
        self.registration_svc = registration_svc
        self.ticket_svc = ticket_svc
        self.auth_svc = auth_svc
        #:設計 06 §12.4 列 5 個 Protocol 含 lottery;.6 補上。
        # Optional 是為了測試 backward compat;production wire 都會傳。
        self.lottery_svc = lottery_svc

    # 全修:活動取消整鏈路(event 標 status + ticket 撤銷 + 通知)

    async def cancel_event(
        self,
        *,
        event_id: str,
        actor_id: str,
        actor_role: str,
        reason: str | None = None,
        request_id: str | None = None,
    ) -> EventDetail:
        """活動取消整鏈路(設計 §10.8 + FR-EVT-09 / FR-NOTIF-06):

        1. event_svc.cancel_event:標 status=CANCELLED + 寫 audit
        2. ticket_svc.revoke_tickets_by_event_cancelled:bulk 撤銷該活動所有 ISSUED 票
           + 寫 audit + publish EventCancelled(含 affected_user_ids)
        3. notification 模組訂閱 EventCancelled → 對所有受影響 user 發 EVENT_CANCELLED 通知

        admin 層協調是因為 layer 不允許 event 模組依賴 ticket 模組。
        """
        detail = await self.event_svc.cancel_event(
            event_id=event_id,
            actor_id=actor_id,
            actor_role=actor_role,
            reason=reason,
            request_id=request_id,
        )
        await self.ticket_svc.revoke_tickets_by_event_cancelled(
            event_id=event_id,
            reason=reason or "活動取消",
            actor_id=actor_id,
            actor_role=actor_role,
        )
        return detail

    # 13.5 廠區人數預覽

    async def get_site_employee_count(self, sites: list[str]) -> SiteEmployeeCount:
        """活動建立時供前端預覽 allowed_sites 對應人數"""
        counts = await self.auth_svc.count_active_employees_by_sites(sites)
        return SiteEmployeeCount(sites=counts, total=sum(counts.values()))

    # 13.6 活動報名清單

    async def list_event_registrations(
        self,
        event_id: str,
        *,
        session_id: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
        mask_pii: bool = True,
    ) -> PagedResult[RegistrationWithUser]:
        """列出活動的所有報名 + user 批次取 + PII mask。

        .2:SQL 下推分頁(取代 in-memory sort+slice),交 PG 命中
        idx_registrations_session 索引。
        """
        ev = await self.event_svc.get_event(event_id)
        if ev is None:
            raise EventNotFoundError(f"活動 {event_id} 不存在")

        # 篩選 session(若指定 session_id 限定;否則跨全部 session)
        target_session_ids = (
            [s.id for s in ev.sessions if s.id == session_id]
            if session_id
            else [s.id for s in ev.sessions]
        )
        if session_id and not target_session_ids:
            raise EventNotFoundError(f"活動 {event_id} 無 session {session_id}")

        # 1. SQL 下推分頁(LIMIT/OFFSET by PG)
        offset = (page - 1) * page_size
        page_regs, total = await self.registration_svc.list_by_session_ids_paged(
            target_session_ids, status=status, offset=offset, limit=page_size
        )

        # 2. 批次取 user
        user_ids = list({r.user_id for r in page_regs})
        users = await self.auth_svc.get_users_batch(user_ids)
        users_by_id = {u.id: u for u in users}

        # 3. session/ticket_type 名稱 lookup
        session_title_by_id = {s.id: s.title for s in ev.sessions}
        ticket_type_name_by_id: dict[str, str] = {}
        for s in ev.sessions:
            for tt in getattr(s, "ticket_types", []) or []:
                ticket_type_name_by_id[tt.id] = tt.name

        items: list[RegistrationWithUser] = []
        for reg in page_regs:
            u = users_by_id.get(reg.user_id)
            if u is None:
                continue
            items.append(
                RegistrationWithUser(
                    id=reg.id,
                    user=RegistrationUserView(
                        employee_id=(
                            mask_employee_id(u.employee_id or "")
                            if mask_pii
                            else (u.employee_id or "")
                        ),
                        name=mask_name(u.name) if mask_pii else u.name,
                        department=u.department,
                        site=str(u.site),
                    ),
                    session_title=session_title_by_id.get(reg.session_id, ""),
                    ticket_type_name=ticket_type_name_by_id.get(reg.ticket_type_id, ""),
                    status=str(reg.status),
                    lottery_rank=reg.lottery_rank,
                    created_at=reg.created_at,
                )
            )

        return PagedResult[RegistrationWithUser].build(
            items, page=page, page_size=page_size, total=total
        )

    # 13.7 儀表板

    async def get_event_dashboard(self, event_id: str) -> DashboardData:
        """聚合儀表板統計(設計 06 §12.4 + 05 §13.7)。

         後優化:list_by_session 對每場只跑一次(原本 timeline / TT
        進度 + user 廠區分布各跑一次,共 2N+1 → 改 N+1)。
        """
        ev = await self.event_svc.get_event(event_id)
        if ev is None:
            raise EventNotFoundError(f"活動 {event_id} 不存在")

        # 1. 一次掃 — timeline / site / ticket_type 進度 + 收 user_id
        # bug fix:CANCELLED 是員工主動撤回的報名,不該計入「報名人數」
        # /「廠區分布」/「時間分布」(會誇大實際參與人數,影響 admin 決策依據)。
        # LOST / FORFEITED / EXPIRED 仍計入 — 這些是「曾經有效報過、終態才落空」
        # 的歷史紀錄,符合「報名數 = 曾經報過名的人(不含主動撤回)」常見定義。
        timeline_buckets: dict[date, int] = defaultdict(int)
        site_buckets: dict[str, int] = defaultdict(int)
        registered_by_tt: dict[str, int] = defaultdict(int)
        won_by_tt: dict[str, int] = defaultdict(int)
        confirmed_by_tt: dict[str, int] = defaultdict(int)
        all_user_ids: list[str] = []
        for sess in ev.sessions:
            regs = await self.registration_svc.list_by_session(sess.id)
            for r in regs:
                if r.status == "CANCELLED":
                    continue # 主動撤回不算報名數
                timeline_buckets[r.created_at.date()] += 1
                registered_by_tt[r.ticket_type_id] += 1
                all_user_ids.append(r.user_id)
                if r.status in ("WON", "CONFIRMED", "USED"):
                    won_by_tt[r.ticket_type_id] += 1
                if r.status in ("CONFIRMED", "USED"):
                    confirmed_by_tt[r.ticket_type_id] += 1

        # 2. 廠區分布需 user batch
        users = await self.auth_svc.get_users_batch(list(set(all_user_ids)))
        user_site_by_id = {u.id: str(u.site) for u in users}
        for uid in all_user_ids:
            site = user_site_by_id.get(uid)
            if site:
                site_buckets[site] += 1

        # 3. ticket_type_progress
        tt_progress: list[TicketTypeProgress] = []
        for sess in ev.sessions:
            for tt in getattr(sess, "ticket_types", []) or []:
                tt_progress.append(
                    TicketTypeProgress(
                        ticket_type_id=tt.id,
                        name=tt.name,
                        quota=int(tt.quota),
                        registered=registered_by_tt.get(tt.id, 0),
                        won=won_by_tt.get(tt.id, 0),
                        confirmed=confirmed_by_tt.get(tt.id, 0),
                    )
                )

        # 4. lottery 狀態 — 若有 lottery_svc 取真實 record();否則從 session 推算
        lottery_at: datetime | None = ev.sessions[0].lottery_at if ev.sessions else None
        executed = bool(ev.sessions) and all(s.status == "LOTTERY_COMPLETED" for s in ev.sessions)

        # 5. 入場統計
        total_confirmed = 0
        checked_in = 0
        for sess in ev.sessions:
            stats = await self.ticket_svc.count_attendance(sess.id)
            total_confirmed += stats.issued + stats.used # confirmed 後即 ISSUED;USED 也算
            checked_in += stats.used

        return DashboardData(
            event_id=event_id,
            registration_timeline=[
                TimelinePoint(date=d, count=c) for d, c in sorted(timeline_buckets.items())
            ],
            site_distribution=[SiteCount(site=s, count=c) for s, c in sorted(site_buckets.items())],
            ticket_type_progress=tt_progress,
            lottery_status=LotteryStatusInfo(executed=executed, lottery_at=lottery_at),
            attendance=AttendanceSummary(checked_in=checked_in, total_confirmed=total_confirmed),
        )

    async def assert_export_size(self, event_id: str, *, status: str | None = None) -> None:
        """:export 前先 dry-count,> EXPORT_SYNC_LIMIT 拋 ExportTooLargeError。
        避免靜默截斷大活動匯出 + in-memory 載 5000 筆 PII 的 OOM 風險。
        """
        ev = await self.event_svc.get_event(event_id)
        if ev is None:
            raise EventNotFoundError(f"活動 {event_id} 不存在")
        total = 0
        for sess in ev.sessions:
            regs = await self.registration_svc.list_by_session(sess.id, status=status)
            total += len(regs)
            if total > self.EXPORT_SYNC_LIMIT:
                raise ExportTooLargeError(
                    f"活動 {event_id} 報名筆數 > {self.EXPORT_SYNC_LIMIT};"
                    "請走背景匯出()— 目前同步路徑不支援",
                    details={"limit": self.EXPORT_SYNC_LIMIT, "approx_total": total},
                )
