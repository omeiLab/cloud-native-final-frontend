"""registration 模組 Service — 報名 / 取消 / 棄權 / 候補遞補 / 確認逾期掃描

對齊設計 06 §8。提供 RegistrationServiceProtocol 給 + 模組透過 Protocol 注入,
並透過建構子注入 EventServiceProtocol(設計 §7.3 跨模組互動格式)。
"""

from datetime import datetime, timedelta
from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.events import (
    ConfirmationExpired,
    RegistrationCreated,
    WaitlistPromoted,
    event_bus,
)
from app.core.logging import get_logger
from app.core.metrics import (
    REGISTRATION_EXPIRED_TOTAL,
    REGISTRATION_WAITLIST_PROMOTED,
)
from app.core.time import now_utc
from app.modules.auth.dependencies import require_service_actor
from app.modules.auth.service import AuthServiceProtocol
from app.modules.event.service import EventServiceProtocol
from app.modules.registration.errors import (
    AlreadyRegisteredError,
    AudienceMismatchError,
    CannotCancelError,
    CannotForfeitError,
    DependentInvalidError,
    IneligibleError,
    RegistrationClosedError,
    RegistrationNotFoundError,
)
from app.modules.registration.models import Registration
from app.modules.registration.repository import RegistrationRepository
from app.shared.enums import EligibilityReason, RegistrationStatus
from app.shared.registration_ref import RegistrationDetail, RegistrationRef

logger = get_logger(__name__)


@runtime_checkable
class RegistrationServiceProtocol(Protocol):
    """跨模組呼叫介面(對齊設計 06 §8.3)。

     lottery / ticket / admin 透過此 Protocol 注入,
    避免直接 import 具體 RegistrationService 類別。
    """

    # ─── 給 lottery 用 ───
    async def list_registered_for_lottery(
        self, session_id: str, ticket_type_id: str
    ) -> list[RegistrationRef]:...

    async def list_winners_for_audit(
        self, session_id: str, ticket_type_id: str
    ) -> list[RegistrationRef]:
        """供 lottery.replay_for_audit 用 — 撈該 session+ticket_type 的 winners,
        排序對齊原抽籤(by lottery_rank ASC)。比 list_by_session 更精準,
        避免拉整場 N 筆 + Python filter。
        """
        ...

    async def list_lottery_outcome_user_ids(
        self, session_id: str, ticket_type_id: str
    ) -> tuple[list[str], list[str], list[str]]:
        """ 全修:抽完籤後依最新 status 分類 user_id,給 LotteryCompleted
        通知用(避免 WAITLISTED 員工被當 LOST 通知,違反 FR-NOTIF-06)。

        回 (winner_user_ids, waitlist_user_ids, loser_user_ids)。
        """
        ...

    async def apply_lottery_results(
        self,
        session_id: str,
        ticket_type_id: str,
        winners: list[tuple[str, int]],
        waitlist: list[tuple[str, int, int]],
        losers: list[str],
        confirmation_deadline: datetime,
    ) -> None:
        """注:相對設計 §8.3 簽名 waitlist 加 position(int)、加 confirmation_deadline。
        理由:rank 是抽籤排名,position 是候補序號;deadline 由 lottery 算好統一塞,
        免除 registration 模組重新查 session.confirmation_deadline_hours。
        """
        ...

    # ─── 給 ticket 用(確認中籤跨模組原子操作) ───
    async def lock_for_confirmation(
        self, registration_id: str, session: "AsyncSession"
    ) -> RegistrationDetail:
        """SELECT FOR UPDATE 鎖住該筆(舊 ownership-naive 版,僅 internal/admin 用)。
         新增 lock_owned_for_confirmation 給 user-facing 路徑用(-5)。
        """
        ...

    async def lock_owned_for_confirmation(
        self,
        registration_id: str,
        actor_user_id: str,
        session: "AsyncSession",
    ) -> RegistrationDetail:
        """:ownership-aware lock。actor=員工,允許 confirm
        - 自己的 reg(reg.user_id == actor_user_id)
        - 自己代報眷屬的 reg(reg.user_id 對應 DEPENDENT user,且
          dependents.employee_user_id == actor_user_id)
        其他情況 raise RegistrationNotFoundError(防越權探測)。
        """
        ...

    async def mark_confirmed_in_session(
        self, registration_id: str, session: "AsyncSession"
    ) -> None:
        """把 registration.status WON → CONFIRMED(設計 06 §5.4 跨模組原子例外)。

        必須在 lock_for_confirmation 之後同 session 內呼叫。本方法只下單一 UPDATE,
        不 commit;由 caller(ticket.confirm_registration_and_issue_ticket)在
        ticket INSERT 後一起 commit。封裝 registrations 表的寫入細節,避免 ticket
        模組對 registration schema 建立硬編碼相依(替代先前 raw SQL `text()`)。
        """
        ...

    # ─── 給 admin / notification 用(internal 裸讀)───
    async def get_registration(self, registration_id: str) -> RegistrationDetail | None:...

    async def get_owned_registration(
        self, registration_id: str, actor_user_id: str
    ) -> RegistrationDetail | None:
        """:ownership-aware get(user-facing 用,擋越權)。
        actor 自己 reg 或代報眷屬 reg → 回傳;否則 None(不洩漏存在性)。
        """
        ...

    async def list_by_session(
        self, session_id: str, status: str | None = None
    ) -> list[RegistrationDetail]:...

    async def list_by_session_ids_paged(
        self,
        session_ids: list[str],
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[RegistrationDetail], int]:
        """.2:admin list_event_registrations 用 — SQL 下推分頁,
        避免 in-memory sort+slice。回傳 (page_items, total)。"""
        ...

    async def list_won_with_deadline_in_window(
        self, deadline_after: datetime, deadline_before: datetime, *, limit: int = 500
    ) -> list[RegistrationDetail]:
        """.1:confirmation_reminder_scan 用 — WON 狀態 + deadline 在
        (after, before] 區間。命中 idx_registrations_confirmation_pending"""
        ...

    async def count_by_status_per_session(
        self, session_ids: list[str]
    ) -> dict[str, dict[str, int]]:
        """每個 session_id → {status: count} 對應字典(空 status 時不出現)"""
        ...


class RegistrationService:
    def __init__(
        self,
        session: AsyncSession,
        event_svc: EventServiceProtocol,
        auth_svc: "AuthServiceProtocol | None" = None,
    ) -> None:
        """:auth_svc 注入(可選 — 既有 caller 不傳維持向後相容,
        但 user-facing 路徑 create / cancel / forfeit / list_my_registrations
        要求 caller 傳;否則 ownership 驗證失敗時 fallback 邏輯保守拒絕)。
        """
        self.session = session
        self.event_svc = event_svc
        self.auth_svc = auth_svc
        self.repo = RegistrationRepository(session)

    # 員工端

    async def create(
        self,
        *,
        user_id: str,
        user_site: str,
        user_role: str,
        session_id: str,
        ticket_type_id: str,
        as_dependent_id: str | None = None,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> RegistrationDetail:
        """報名(獨立報名 + 員工代報眷屬)。

        1. service 層 RBAC(-22):actor 必為 EMPLOYEE/ADMIN(防 DEPENDENT 偽造)
        2. as_dependent_id 解析:
           - None → 員工自報,actual_user_id = user_id,expected_audience='EMPLOYEE'
           - 非 None → auth_svc 驗 ownership,actual_user_id = dependent.user_id,
             expected_audience='DEPENDENT'
        3. eligibility(廠區 + 報名期間)
        4. ticket_type.audience 必須對應 expected_audience
        5. INSERT(IntegrityError → AlreadyRegisteredError 訊息差異化)
        6. audit + commit
        """
        # -22 service 層守衛(VERIFIER 也是員工身分,可報名;ADMIN_VIEWER / DEPENDENT 不行)
        require_service_actor(user_role, {"EMPLOYEE", "ADMIN", "VERIFIER"})

        # 1. 解析「實際被報名者」
        actual_user_id: str
        actual_user_site: str
        expected_audience: str
        as_dep_name: str | None = None
        if as_dependent_id:
            if self.auth_svc is None:
                raise DependentInvalidError("代報眷屬需 auth_svc(內部錯誤)")
            deps = await self.auth_svc.get_dependents_owned([as_dependent_id], user_id)
            if not deps:
                raise DependentInvalidError("眷屬 ID 不存在 / 非本人擁有 / 已停用")
            actual_user_id = deps[0].user_id
            # 眷屬廠區從員工繼承(0009 backfill 時抓 employee.site);user_site 仍以 caller 傳入為準
            actual_user_site = user_site
            expected_audience = "DEPENDENT"
            as_dep_name = deps[0].name
        else:
            actual_user_id = user_id
            actual_user_site = user_site
            expected_audience = "EMPLOYEE"

        # 2. eligibility
        eligibility = await self.event_svc.check_eligibility(actual_user_site, session_id)
        if not eligibility.eligible:
            if eligibility.reason_code == EligibilityReason.SITE_MISMATCH:
                raise IneligibleError(eligibility.reason or "廠區資格不符")
            raise RegistrationClosedError(eligibility.reason or "報名不可用")

        # 3. 票種要存在 + audience 對應
        ticket_type = await self.event_svc.get_ticket_type(ticket_type_id)
        if ticket_type is None or ticket_type.session_id != session_id:
            raise RegistrationClosedError("票種不存在或不屬於此場次")
        tt_audience = getattr(ticket_type, "audience", "EMPLOYEE")
        if tt_audience != expected_audience:
            raise AudienceMismatchError(
                f"票種 audience={tt_audience} 與報名身分 {expected_audience} 不符"
            )

        # 4. INSERT
        try:
            reg = await self.repo.create(
                user_id=actual_user_id,
                session_id=session_id,
                ticket_type_id=ticket_type_id,
            )
        except AlreadyRegisteredError:
            # 訊息差異化(R3 補)
            if as_dependent_id and as_dep_name:
                raise AlreadyRegisteredError(f"眷屬 {as_dep_name} 已報名此場次") from None
            raise

        await audit(
            self.session,
            actor_id=user_id, # actor 仍是員工(代報時也是員工)
            actor_role=user_role,
            action="registration.create",
            entity_type="registration",
            entity_id=reg.id,
            after={
                "session_id": session_id,
                "ticket_type_id": ticket_type_id,
                "status": "REGISTERED",
                "actual_user_id": actual_user_id,
                "as_dependent_id": as_dependent_id,
                "audience": expected_audience,
            },
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        logger.info(
            "registration_created",
            registration_id=reg.id,
            user_id=user_id,
            session_id=session_id,
        )
        #:publish event 給 notification 模組(設計 §5.5 in-process bus)
        # 取活動標題:由 caller 傳入 / event_svc 查 — 簡化用 session.event_id 反查
        try:
            sess_info = await self.event_svc.get_session(session_id)
            event_title = ""
            session_starts_at = ""
            if sess_info:
                event_title = getattr(sess_info, "event_title", "") or sess_info.title
                session_starts_at = sess_info.starts_at.isoformat() if sess_info.starts_at else ""
            await event_bus.publish(
                RegistrationCreated(
                    registration_id=reg.id,
                    user_id=user_id,
                    session_id=session_id,
                    event_title=event_title,
                    session_starts_at=session_starts_at,
                )
            )
        except Exception:
            # event publish 失敗不該擋主流程(已 commit)
            logger.exception("registration_created_event_publish_failed", reg_id=reg.id)
        return _to_detail(reg)

    async def cancel(
        self,
        *,
        registration_id: str,
        user_id: str,
        user_role: str,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> RegistrationDetail:
        """取消報名 — 只 REGISTERED 狀態可取消(抽籤後不能取消,要走 forfeit)"""
        reg = await self._get_owned(registration_id, user_id, lock=True)

        if reg.status != "REGISTERED":
            raise CannotCancelError(f"目前狀態為 {reg.status},只有 REGISTERED 狀態可以取消")

        before_status = reg.status
        # expected_status='REGISTERED' 給並行守衛(雖然 lock 已串行化,雙保險)
        updated = await self.repo.update_status(
            registration_id,
            "CANCELLED",
            expected_status="REGISTERED",
            cancelled_at=now_utc(),
        )
        if updated is None:
            # 並行已被改掉 → 視為狀態錯誤而非 NotFound
            raise CannotCancelError("報名狀態已變更,請重新整理後再試")

        await audit(
            self.session,
            actor_id=user_id,
            actor_role=user_role,
            action="registration.cancel",
            entity_type="registration",
            entity_id=registration_id,
            before={"status": before_status},
            after={"status": "CANCELLED"},
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        return _to_detail(updated)

    async def forfeit(
        self,
        *,
        registration_id: str,
        user_id: str,
        user_role: str,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> RegistrationDetail:
        """中籤後棄權 — 只 WON 狀態可棄權,棄權後觸發候補遞補(設計 06 §8.6)"""
        reg = await self._get_owned(registration_id, user_id, lock=True)

        if reg.status != "WON":
            raise CannotForfeitError(f"目前狀態為 {reg.status},只有 WON 狀態可以棄權")

        before_status = reg.status
        # expected_status='WON' 守衛 — 雙重 forfeit race 一定有一個失敗
        updated = await self.repo.update_status(
            registration_id,
            "FORFEITED",
            expected_status="WON",
            forfeited_at=now_utc(),
        )
        if updated is None:
            # 並行已被別人改掉(自己的另一台裝置 / SYSTEM expire)
            raise CannotForfeitError("報名狀態已變更,請重新整理後再試")

        await audit(
            self.session,
            actor_id=user_id,
            actor_role=user_role,
            action="registration.forfeit",
            entity_type="registration",
            entity_id=registration_id,
            before={"status": before_status},
            after={"status": "FORFEITED"},
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        # 設計 07 §7 設計要點:棄權與遞補應為兩個獨立 transaction(以事件鏈接)
        # 先 commit forfeit → promotion 開新 tx;promotion 失敗不影響 forfeit
        await self.session.commit()

        try:
            promoted_id = await self._trigger_waitlist_promotion(
                reg.session_id, reg.ticket_type_id, request_id=request_id
            )
            await self.session.commit()
            if promoted_id:
                REGISTRATION_WAITLIST_PROMOTED.labels(trigger="forfeit").inc()
                logger.info(
                    "waitlist_promoted_after_forfeit",
                    forfeited_registration_id=registration_id,
                    promoted_registration_id=promoted_id,
                )
                # 全修:補 publish WaitlistPromoted 給 notification 模組
                # (expire_overdue_won 路徑已有 publish,forfeit 路徑之前漏掉,
                # 違反 FR-NOTIF-06 — 棄權後遞補者收不到 WAITLIST_PROMOTED 通知)
                try:
                    promoted_reg = await self.repo.get_by_id(promoted_id)
                    if promoted_reg:
                        await event_bus.publish(
                            WaitlistPromoted(
                                registration_id=promoted_id,
                                user_id=str(promoted_reg.user_id),
                                session_id=reg.session_id,
                                event_title="",
                                confirmation_deadline=(
                                    promoted_reg.confirmation_deadline.isoformat()
                                    if promoted_reg.confirmation_deadline
                                    else ""
                                ),
                            )
                        )
                except Exception:
                    logger.exception(
                        "publish_waitlist_promoted_after_forfeit_failed",
                        promoted_registration_id=promoted_id,
                    )
        except Exception:
            # promotion 失敗 user-visible 端不該失敗 — forfeit 已落地, event_bus
            # 接手後可由補償 job 再跑;這層只 log
            await self.session.rollback()
            logger.exception(
                "waitlist_promotion_failed_after_forfeit",
                forfeited_registration_id=registration_id,
            )
        return _to_detail(updated)

    async def list_my_registrations(
        self,
        *,
        user_id: str,
        status_filter: list[str] | None = None,
        time_filter: str = "all",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[RegistrationDetail], int]:
        """我的報名清單(/14)。

        :UNION 員工自己 + 所有眷屬(含 INACTIVE,因歷史 reg/ticket 不該因
        眷屬軟刪後消失)。SQL 層用 IN(user_ids) 一次查 + 全域 ORDER BY + 分頁。

        time_filter:
        - "upcoming":session.starts_at > now
        - "past":session.starts_at <= now
        - "all":不過濾
        """
        #:取所有眷屬 user_id(含 INACTIVE)
        user_ids = [user_id]
        dep_user_id_to_id: dict[str, str] = {}
        if self.auth_svc is not None:
            deps = await self.auth_svc.list_dependents(user_id, include_inactive=True)
            for d in deps:
                user_ids.append(d.user_id)
                dep_user_id_to_id[d.user_id] = d.id

        def _detail(r: Registration) -> RegistrationDetail:
            return _to_detail(r, as_dependent_id=dep_user_id_to_id.get(r.user_id))

        if time_filter == "all":
            offset = (page - 1) * page_size
            rows, total = await self.repo.list_by_users(
                user_ids, status_in=status_filter, offset=offset, limit=page_size
            )
            return [_detail(r) for r in rows], total

        # time_filter != all:撈所有 reg → 對每筆查 session.starts_at → 過濾 → 分頁
        all_rows, _ = await self.repo.list_by_users(
            user_ids, status_in=status_filter, offset=0, limit=10000
        )
        now = now_utc()
        filtered: list[Registration] = []
        for reg in all_rows:
            sess = await self.event_svc.get_session(reg.session_id)
            if sess is None:
                continue
            is_upcoming = sess.starts_at > now
            keep = (time_filter == "upcoming" and is_upcoming) or (
                time_filter == "past" and not is_upcoming
            )
            if keep:
                filtered.append(reg)

        total = len(filtered)
        offset = (page - 1) * page_size
        page_rows = filtered[offset: offset + page_size]
        return [_detail(r) for r in page_rows], total

    async def get_owned_registration(
        self, registration_id: str, actor_user_id: str
    ) -> RegistrationDetail | None:
        """:ownership-aware get(user-facing 用)。"""
        try:
            reg = await self._get_owned(registration_id, actor_user_id, lock=False)
        except RegistrationNotFoundError:
            return None
        as_dep_id: str | None = None
        if self.auth_svc is not None and reg.user_id != actor_user_id:
            dep = await self.auth_svc.get_dependent_by_user_id(reg.user_id)
            if dep is not None:
                as_dep_id = dep.id
        return _to_detail(reg, as_dependent_id=as_dep_id)

    # 跨模組介面(對外 Protocol)

    async def get_registration(self, registration_id: str) -> RegistrationDetail | None:
        reg = await self.repo.get_by_id(registration_id)
        return _to_detail(reg) if reg else None

    async def list_registered_for_lottery(
        self, session_id: str, ticket_type_id: str
    ) -> list[RegistrationRef]:
        """ lottery 取候選人(status='REGISTERED')"""
        rows = await self.repo.list_by_session_ticket_type(
            session_id, ticket_type_id, status_in=["REGISTERED"]
        )
        return [_to_ref(r) for r in rows]

    async def list_winners_for_audit(
        self, session_id: str, ticket_type_id: str
    ) -> list[RegistrationRef]:
        """ lottery.replay_for_audit 用 — 撈該 ticket_type 的 winners,by lottery_rank ASC"""
        rows = await self.repo.list_by_session_ticket_type(
            session_id, ticket_type_id, status_in=["WON"]
        )
        # repo 預設按 created_at 排,winners 要 lottery_rank
        rows.sort(key=lambda r: r.lottery_rank or 0)
        return [_to_ref(r) for r in rows]

    async def list_lottery_outcome_user_ids(
        self, session_id: str, ticket_type_id: str
    ) -> tuple[list[str], list[str], list[str]]:
        """ 全修:依最新 status 分 (winner / waitlist / loser) user_ids。

        winner = WON,waitlist = WAITLISTED,loser = LOST。
        WON / WAITLISTED 排序按 lottery_rank / waitlist_position 升冪。
        """
        winner_rows = await self.repo.list_by_session_ticket_type(
            session_id, ticket_type_id, status_in=["WON"]
        )
        winner_rows.sort(key=lambda r: r.lottery_rank or 0)
        waitlist_rows = await self.repo.list_by_session_ticket_type(
            session_id, ticket_type_id, status_in=["WAITLISTED"]
        )
        waitlist_rows.sort(key=lambda r: r.waitlist_position or 0)
        loser_rows = await self.repo.list_by_session_ticket_type(
            session_id, ticket_type_id, status_in=["LOST"]
        )
        return (
            [str(r.user_id) for r in winner_rows],
            [str(r.user_id) for r in waitlist_rows],
            [str(r.user_id) for r in loser_rows],
        )

    async def apply_lottery_results(
        self,
        session_id: str,
        ticket_type_id: str,
        winners: list[tuple[str, int]],
        waitlist: list[tuple[str, int, int]],
        losers: list[str],
        confirmation_deadline: datetime,
    ) -> None:
        """ lottery 抽完後寫回(批次)。caller 自負 transaction commit"""
        await self.repo.bulk_apply_lottery(
            winners=winners,
            waitlist=waitlist,
            losers=losers,
            confirmation_deadline=confirmation_deadline,
        )

    async def lock_for_confirmation(
        self,
        registration_id: str,
        session: AsyncSession,
    ) -> RegistrationDetail:
        """ ticket 確認中籤前 SELECT FOR UPDATE 鎖住(設計 06 §7.5)。

        舊 ownership-naive 版,僅 internal/admin 用。User-facing 路徑請改用
        lock_owned_for_confirmation(ownership-aware)。
        """
        temp_repo = RegistrationRepository(session)
        reg = await temp_repo.get_by_id_for_update(registration_id)
        if reg is None:
            raise RegistrationNotFoundError("報名紀錄不存在")
        return _to_detail(reg)

    async def lock_owned_for_confirmation(
        self,
        registration_id: str,
        actor_user_id: str,
        session: AsyncSession,
    ) -> RegistrationDetail:
        """:ownership-aware lock。actor=員工,允許 confirm
        - 自己 reg(reg.user_id == actor_user_id)
        - 自己代報眷屬 reg(reg.user_id 對應 DEPENDENT user 且 employee_user_id == actor_user_id)
        其他情況 → RegistrationNotFoundError(防越權探測)。
        """
        temp_repo = RegistrationRepository(session)
        reg = await temp_repo.get_by_id_for_update(registration_id)
        if reg is None:
            raise RegistrationNotFoundError("報名紀錄不存在")
        # 自己的
        if reg.user_id == actor_user_id:
            return _to_detail(reg)
        # 代報眷屬:驗 dependents.employee_user_id
        if self.auth_svc is not None:
            emp_deps = await self.auth_svc.list_dependents(actor_user_id, include_inactive=True)
            for d in emp_deps:
                if d.user_id == reg.user_id:
                    return _to_detail(reg, as_dependent_id=d.id)
        raise RegistrationNotFoundError("報名紀錄不存在")

    async def mark_confirmed_in_session(
        self,
        registration_id: str,
        session: AsyncSession,
    ) -> None:
        """ticket.confirm_registration_and_issue_ticket 的跨模組原子寫入點。

        caller 已透過 lock_for_confirmation 持有 row lock 並驗證 status='WON',
        本方法只在 caller 的 session 上下一筆 UPDATE,不 commit。
        expected_status='WON' 仍保留為 belt-and-suspenders;若被改即代表外部干擾,
        rowcount=0 但目前 caller 流程下不會發生(lock 持續中)。
        """
        temp_repo = RegistrationRepository(session)
        await temp_repo.update_status(
            registration_id,
            "CONFIRMED",
            expected_status="WON",
            confirmed_at=now_utc(),
        )

    async def list_by_session(
        self, session_id: str, status: str | None = None
    ) -> list[RegistrationDetail]:
        """admin / lottery 取場次內所有報名(可按 status 過濾)"""
        rows = await self.repo.list_by_session(session_id, status=status)
        return [_to_detail(r) for r in rows]

    async def list_by_session_ids_paged(
        self,
        session_ids: list[str],
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[RegistrationDetail], int]:
        """.2:SQL 下推分頁(ok — admin 不直接讀 registration repo)"""
        rows, total = await self.repo.list_by_session_ids_paged(
            session_ids, status=status, offset=offset, limit=limit
        )
        return [_to_detail(r) for r in rows], total

    async def list_won_with_deadline_in_window(
        self,
        deadline_after: datetime,
        deadline_before: datetime,
        *,
        limit: int = 500,
    ) -> list[RegistrationDetail]:
        """.1:confirmation_reminder_scan 用"""
        rows = await self.repo.list_won_with_deadline_in_window(
            deadline_after, deadline_before, limit=limit
        )
        return [_to_detail(r) for r in rows]

    async def count_by_status_per_session(
        self, session_ids: list[str]
    ) -> dict[str, dict[str, int]]:
        """admin 統計用 — 每個 session_id 對應一個 {status: count} dict。

        空 session_ids 直接回 {};某 session 沒任何 registration 仍出現,值為 {}。
        """
        if not session_ids:
            return {}
        return await self.repo.count_by_session_ids_grouped(session_ids)

    # APScheduler 任務 / 內部

    async def expire_overdue_won(self) -> int:
        """掃描逾期未確認的中籤,改 EXPIRED 並觸發候補遞補。回傳成功處理筆數。

        設計 06 §8.7、07 §8。caller 是 APScheduler,已用 pg_try_advisory_xact_lock
        確保跨副本互斥(綁在外層 transaction,commit 時釋放)。

        每筆用 SAVEPOINT 隔離:單筆 EXPIRED + audit + promotion 任一失敗只
        rollback 該筆,其餘繼續處理;promotion 失敗只 rollback promotion,
        EXPIRED 仍落地。advisory lock 整批保留到最後 commit。
        """
        rows = await self.repo.find_overdue_won() # repo default = OVERDUE_SCAN_BATCH
        if not rows:
            return 0

        processed = 0
        #:收集成功 expire / promotion 的事件,commit 後一次 publish
        expired_events: list[ConfirmationExpired] = []
        promoted_events: list[WaitlistPromoted] = []
        for reg in rows:
            row_savepoint = await self.session.begin_nested()
            try:
                # EXPIRED 不寫 forfeited_at;expected_status='WON' 防 race
                updated = await self.repo.update_status(reg.id, "EXPIRED", expected_status="WON")
                if updated is None:
                    await row_savepoint.rollback()
                    continue
                await audit(
                    self.session,
                    actor_id=None,
                    actor_role="SYSTEM",
                    action="registration.expire_overdue",
                    entity_type="registration",
                    entity_id=reg.id,
                    before={"status": "WON"},
                    after={"status": "EXPIRED"},
                )

                # promotion 用嵌套 savepoint:失敗只 rollback promotion,EXPIRED 仍保留
                promo_savepoint = await self.session.begin_nested()
                promoted_id = None
                try:
                    promoted_id = await self._trigger_waitlist_promotion(
                        reg.session_id, reg.ticket_type_id
                    )
                    await promo_savepoint.commit()
                    if promoted_id:
                        REGISTRATION_WAITLIST_PROMOTED.labels(trigger="expire").inc()
                        logger.info(
                            "waitlist_promoted_after_expire",
                            expired_registration_id=reg.id,
                            promoted_registration_id=promoted_id,
                        )
                except Exception:
                    await promo_savepoint.rollback()
                    logger.exception(
                        "waitlist_promotion_failed_after_expire",
                        expired_registration_id=reg.id,
                    )

                await row_savepoint.commit()
                REGISTRATION_EXPIRED_TOTAL.inc()
                processed += 1

                # 暫存 events 等 commit 後 publish
                expired_events.append(
                    ConfirmationExpired(
                        registration_id=reg.id,
                        user_id=str(reg.user_id),
                        event_title="", # caller(notification handler)若需可再查
                        deadline=reg.confirmation_deadline.isoformat()
                        if reg.confirmation_deadline
                        else "",
                    )
                )
                if promoted_id:
                    promoted_reg = await self.repo.get_by_id(promoted_id)
                    if promoted_reg:
                        promoted_events.append(
                            WaitlistPromoted(
                                registration_id=promoted_id,
                                user_id=str(promoted_reg.user_id),
                                session_id=reg.session_id,
                                event_title="",
                                confirmation_deadline=promoted_reg.confirmation_deadline.isoformat()
                                if promoted_reg.confirmation_deadline
                                else "",
                            )
                        )
            except Exception:
                await row_savepoint.rollback()
                logger.exception("expire_overdue_won_row_failed", registration_id=reg.id)

        await self.session.commit()
        # publish 事件 — 失敗不擋主流程
        for ev in expired_events:
            try:
                await event_bus.publish(ev)
            except Exception:
                logger.exception("publish_confirmation_expired_failed", reg_id=ev.registration_id)
        for ev2 in promoted_events:
            try:
                await event_bus.publish(ev2)
            except Exception:
                logger.exception("publish_waitlist_promoted_failed", reg_id=ev2.registration_id)
        logger.info("expire_overdue_won_processed", count=processed)
        return processed

    async def _trigger_waitlist_promotion(
        self,
        session_id: str,
        ticket_type_id: str,
        request_id: str | None = None,
    ) -> str | None:
        """選一筆 lottery_rank 最小的 WAITLISTED → WON,設新 confirmation_deadline。

        設計 06 §8.6。回傳被遞補的 registration_id(無候補時 None)。
        場次須仍在 waitlist_close_at 之前。
        """
        # 場次已過遞補截止 → 不再遞補
        session_info = await self.event_svc.get_session(session_id)
        if session_info is None:
            return None
        if now_utc() > session_info.waitlist_close_at:
            return None

        candidate = await self.repo.find_next_waitlist_for_promotion(session_id, ticket_type_id)
        if candidate is None:
            return None

        deadline = now_utc() + timedelta(hours=session_info.confirmation_deadline_hours)
        promoted = await self.repo.update_status(
            candidate.id,
            "WON",
            confirmation_deadline=deadline,
        )
        if promoted is None:
            return None

        await audit(
            self.session,
            actor_id=None,
            actor_role="SYSTEM",
            action="registration.waitlist_promote",
            entity_type="registration",
            entity_id=candidate.id,
            before={"status": "WAITLISTED"},
            after={"status": "WON", "confirmation_deadline": deadline.isoformat()},
            request_id=request_id,
        )
        # WaitlistPromoted event 由 caller 在 commit 後 publish
        # (forfeit / expire_overdue_won 兩條 path 各自處理)
        return str(candidate.id)

    # Internal helpers

    async def _get_owned(
        self, registration_id: str, user_id: str, *, lock: bool = False
    ) -> Registration:
        """取得 actor 擁有的 registration(ownership 含眷屬代報)。

        Ownership rules:
        1. reg.user_id == user_id(自己)
        2. reg.user_id 對應 DEPENDENT user 且 dependents.employee_user_id == user_id(代報眷屬)
        3. 其他情況 → RegistrationNotFoundError(防越權探測)

        - lock=True 用 SELECT FOR UPDATE(寫操作 cancel/forfeit 用)
        """
        if lock:
            reg = await self.repo.get_by_id_for_update(registration_id)
        else:
            reg = await self.repo.get_by_id(registration_id)
        if reg is None:
            raise RegistrationNotFoundError("報名紀錄不存在")

        # 1. 自己的
        if reg.user_id == user_id:
            return reg

        # 2. 代報眷屬:reg.user_id 是 DEPENDENT user,驗 dependents.employee_user_id
        auth_svc = getattr(self, "auth_svc", None)
        if auth_svc is not None:
            dep = await auth_svc.get_dependent_by_user_id(reg.user_id)
            if dep is not None:
                # 反查 dependent 的 employee_user_id 是否 == 當前 actor
                # 用 list_dependents include_inactive=True 比對 ownership
                emp_deps = await auth_svc.list_dependents(user_id, include_inactive=True)
                if any(d.user_id == reg.user_id for d in emp_deps):
                    return reg

        # 3. 越權 → 偽裝 NotFound
        raise RegistrationNotFoundError("報名紀錄不存在")


def _to_detail(reg: Registration, *, as_dependent_id: str | None = None) -> RegistrationDetail:
    """:廢除 dependent_count/snapshot;加 as_dependent_id(若 reg.user_id 是 DEPENDENT)。
    `as_dependent_id` 由 caller(list_my_registrations / cancel return)填入,
    avoid coupling _to_detail 跟 auth_svc。
    """
    return RegistrationDetail(
        id=reg.id,
        user_id=reg.user_id,
        session_id=reg.session_id,
        ticket_type_id=reg.ticket_type_id,
        status=RegistrationStatus(reg.status),
        lottery_rank=reg.lottery_rank,
        waitlist_position=reg.waitlist_position,
        confirmation_deadline=reg.confirmation_deadline,
        confirmed_at=reg.confirmed_at,
        forfeited_at=reg.forfeited_at,
        cancelled_at=reg.cancelled_at,
        as_dependent_id=as_dependent_id,
        created_at=reg.created_at,
        updated_at=reg.updated_at,
    )


def _to_ref(reg: Registration) -> RegistrationRef:
    return RegistrationRef(
        id=reg.id,
        user_id=reg.user_id,
        session_id=reg.session_id,
        ticket_type_id=reg.ticket_type_id,
        status=RegistrationStatus(reg.status),
        lottery_rank=reg.lottery_rank,
        waitlist_position=reg.waitlist_position,
    )
