"""registration 模組 repository — 只此模組可直接存取 registrations 表"""

from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.core.ulid import generate_ulid
from app.modules.registration.errors import AlreadyRegisteredError
from app.modules.registration.models import Registration

# 單批掃描上限(對齊設計 06 §8.7);可隨容量調整,不再散落 magic number
OVERDUE_SCAN_BATCH = 100


class RegistrationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: str,
        session_id: str,
        ticket_type_id: str,
    ) -> Registration:
        """INSERT;UNIQUE 違反轉 AlreadyRegisteredError(設計 §4.5 BR-01)。

        :回 1:1 — registration 與 ticket 一對一,不再帶 dependent_count/snapshot
        (DB 欄位仍存在直到 0011 cleanup,但 ORM 不寫入,server_default 保證合規)。
        眷屬支援改由 caller 帶 dependent.user_id 作為 user_id,reg.user_id 直接指眷屬。

        Note:不在 repository 自己 rollback,只翻譯例外。caller(service)決定
        rollback 範圍,避免 repo 砍掉 unit-of-work 中其他尚未 flush 的工作。
        """
        now = now_utc()
        reg = Registration(
            id=generate_ulid(),
            user_id=user_id,
            session_id=session_id,
            ticket_type_id=ticket_type_id,
            status="REGISTERED",
            created_at=now,
            updated_at=now,
        )
        self.session.add(reg)
        try:
            await self.session.flush()
        except IntegrityError as e:
            raise AlreadyRegisteredError("此身分已報名此場次") from e
        return reg

    async def get_by_id(self, registration_id: str) -> Registration | None:
        result = await self.session.execute(
            select(Registration).where(Registration.id == registration_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id_for_update(self, registration_id: str) -> Registration | None:
        """SELECT FOR UPDATE — 給 ticket 模組確認中籤跨模組原子操作用(設計 06 §7.5)"""
        result = await self.session.execute(
            select(Registration).where(Registration.id == registration_id).with_for_update()
        )
        return result.scalar_one_or_none()

    async def list_by_user(
        self,
        user_id: str,
        status_in: list[str] | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[Registration], int]:
        base = select(Registration).where(Registration.user_id == user_id)
        if status_in:
            base = base.where(Registration.status.in_(status_in))

        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())

        page_q = base.order_by(Registration.created_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(page_q)
        return list(result.scalars().all()), total

    async def list_by_users(
        self,
        user_ids: list[str],
        *,
        status_in: list[str] | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[Registration], int]:
        """:/me/registrations UNION 員工自己 + 所有眷屬 reg(SQL IN 一次查)。

        list_by_user 多 user_ids 版本;SQL 層分頁 + 全域 ORDER BY,避免
        Python 端 N+1 + concat 造成 total/page_size 不可靠。
        """
        if not user_ids:
            return [], 0
        base = select(Registration).where(Registration.user_id.in_(user_ids))
        if status_in:
            base = base.where(Registration.status.in_(status_in))

        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())

        page_q = base.order_by(Registration.created_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(page_q)
        return list(result.scalars().all()), total

    async def find_next_waitlist_for_promotion_by_audience(
        self, session_id: str, ticket_type_id: str
    ) -> Registration | None:
        """:waitlist promotion 仍同 ticket_type 內找,因 ticket_type 已綁 audience
        (EMP 票種 forfeit 拉同票種 EMP waitlist;DEP 同理)。功能等同既有
        find_next_waitlist_for_promotion(留 alias 為設計 doc 對齊)。
        """
        return await self.find_next_waitlist_for_promotion(session_id, ticket_type_id)

    async def update_status(
        self,
        registration_id: str,
        new_status: str,
        *,
        expected_status: str | None = None,
        **timestamp_fields: datetime,
    ) -> Registration | None:
        """更新狀態 + 對應的時間戳(cancelled_at / forfeited_at / confirmed_at)。

        expected_status 不為 None 時加 ``WHERE status = expected_status``,
        確保多副本 / 重複請求 race 時只一次成功。rowcount == 0 → 回 None,
        caller 應視為「並行已被別人改掉」,而非「不存在」。
        """
        fields: dict[str, Any] = {"status": new_status, "updated_at": now_utc()}
        fields.update(timestamp_fields)
        stmt = update(Registration).where(Registration.id == registration_id)
        if expected_status is not None:
            stmt = stmt.where(Registration.status == expected_status)
        result = await self.session.execute(stmt.values(**fields).returning(Registration))
        await self.session.flush()
        return result.scalar_one_or_none()

    async def list_won_with_deadline_in_window(
        self,
        deadline_after: datetime,
        deadline_before: datetime,
        limit: int = 500,
    ) -> list[Registration]:
        """.1:confirmation_reminder_scan 用 — WON 狀態 + deadline 在
        (after, before] 區間。命中 idx_registrations_confirmation_pending"""
        result = await self.session.execute(
            select(Registration)
            .where(
                and_(
                    Registration.status == "WON",
                    Registration.confirmation_deadline.is_not(None),
                    Registration.confirmation_deadline > deadline_after,
                    Registration.confirmation_deadline <= deadline_before,
                )
            )
            .order_by(Registration.confirmation_deadline.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def find_overdue_won(self, limit: int = OVERDUE_SCAN_BATCH) -> list[Registration]:
        """找已逾期未確認的中籤紀錄(對齊序列圖 §8 + idx_registrations_confirmation_pending)。

        - ORDER BY confirmation_deadline ASC:從最早過期的先處理
        - FOR UPDATE SKIP LOCKED:多副本同時進來時各搶不同 row,即使 advisory
          lock 失效也不會雙重處理(序列圖 §8 步驟 480 設計要點)
        """
        result = await self.session.execute(
            select(Registration)
            .where(
                and_(
                    Registration.status == "WON",
                    Registration.confirmation_deadline.is_not(None),
                    Registration.confirmation_deadline < now_utc(),
                )
            )
            .order_by(Registration.confirmation_deadline.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        return list(result.scalars().all())

    async def find_next_waitlist_for_promotion(
        self, session_id: str, ticket_type_id: str
    ) -> Registration | None:
        """候補遞補:取 lottery_rank 最小的 WAITLISTED 並 SELECT FOR UPDATE SKIP LOCKED

        SKIP LOCKED 讓多個 promotion 任務可並行,各自鎖不同的 row(設計 06 §8.6)。
        """
        result = await self.session.execute(
            select(Registration)
            .where(
                and_(
                    Registration.session_id == session_id,
                    Registration.ticket_type_id == ticket_type_id,
                    Registration.status == "WAITLISTED",
                )
            )
            .order_by(Registration.lottery_rank.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        return result.scalar_one_or_none()

    async def list_by_session_ticket_type(
        self,
        session_id: str,
        ticket_type_id: str,
        status_in: list[str] | None = None,
    ) -> list[Registration]:
        """供 lottery 模組撈候選人 / 統計用"""
        base = select(Registration).where(
            and_(
                Registration.session_id == session_id,
                Registration.ticket_type_id == ticket_type_id,
            )
        )
        if status_in:
            base = base.where(Registration.status.in_(status_in))
        result = await self.session.execute(base.order_by(Registration.created_at.asc()))
        return list(result.scalars().all())

    async def list_by_session_ids_paged(
        self,
        session_ids: list[str],
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Registration], int]:
        """.2:跨多場 session 分頁 — admin list_event_registrations 用。
        SQL 下推 LIMIT/OFFSET 直接交 PG 處理,不在 application 端全載入排序。
        命中 idx_registrations_session(session_id) 索引。
        """
        if not session_ids:
            return [], 0
        base = select(Registration).where(Registration.session_id.in_(session_ids))
        if status:
            base = base.where(Registration.status == status)
        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())
        page_q = base.order_by(Registration.created_at.desc()).offset(offset).limit(limit)
        rows = list((await self.session.execute(page_q)).scalars().all())
        return rows, total

    async def list_by_session(
        self,
        session_id: str,
        status: str | None = None,
    ) -> list[Registration]:
        """admin 用:單純按 session_id (+ optional status) 列出"""
        stmt = select(Registration).where(Registration.session_id == session_id)
        if status:
            stmt = stmt.where(Registration.status == status)
        result = await self.session.execute(stmt.order_by(Registration.created_at.asc()))
        return list(result.scalars().all())

    async def count_by_session_ids_grouped(
        self, session_ids: list[str]
    ) -> dict[str, dict[str, int]]:
        """admin 統計用:批次 session_id → {status: count}。

        每個傳入的 session_id 都會在結果裡(沒紀錄則是空 dict)。
        """
        result = await self.session.execute(
            select(
                Registration.session_id,
                Registration.status,
                func.count(Registration.id),
            )
            .where(Registration.session_id.in_(session_ids))
            .group_by(Registration.session_id, Registration.status)
        )
        out: dict[str, dict[str, int]] = {sid: {} for sid in session_ids}
        for sid, status, count in result.all():
            out[sid][status] = int(count)
        return out

    async def count_by_session_status(self, session_id: str) -> dict[str, int]:
        """admin 統計用:該場次各 status 的計數"""
        result = await self.session.execute(
            select(Registration.status, func.count(Registration.id))
            .where(Registration.session_id == session_id)
            .group_by(Registration.status)
        )
        return {status: int(count) for status, count in result.all()}

    async def bulk_apply_lottery(
        self,
        winners: list[tuple[str, int]],
        waitlist: list[tuple[str, int, int]],
        losers: list[str],
        confirmation_deadline: datetime,
    ) -> None:
        """ lottery 抽籤完成後:批次更新 winners/waitlist/losers。

        winners + waitlist 用 PostgreSQL ``UPDATE FROM (VALUES...)`` 一次過,
        否則 1000 winners 等於 1000 round-trips(NFR P95 撐不住)。
        losers 共用同一個 status,簡單 IN 即可。
        """
        from sqlalchemy import text

        now = now_utc()

        # placeholders 由筆數(int)動態生成:wid_0 等 bind 名稱,所有真實值
        # 都走 SQLAlchemy bind param,不存在 SQL injection 路徑。
        # 三條 UPDATE 都加 `r.status = 'REGISTERED'` 守衛(CAS 樂觀鎖):
        # 防 race — 抽籤 list_registered_for_lottery 讀完後、UPDATE 寫入前,
        # 若 user 先 commit cancel(REGISTERED → CANCELLED),抽籤不會把
        # CANCELLED 覆蓋成 WON / WAITLISTED / LOST。被 cancel 的 row 自動 skip,
        # rowcount < input。
        if winners:
            placeholders = ", ".join(
                f"(:wid_{i}, CAST(:wrank_{i} AS INTEGER))" for i in range(len(winners))
            )
            params: dict[str, object] = {"now": now, "ddl": confirmation_deadline}
            for i, (wid, rank) in enumerate(winners):
                params[f"wid_{i}"] = wid
                params[f"wrank_{i}"] = rank
            sql_winners = f"UPDATE registrations AS r SET status = 'WON', lottery_rank = v.rank, confirmation_deadline =:ddl, updated_at =:now FROM (VALUES {placeholders}) AS v(id, rank) WHERE r.id = v.id AND r.status = 'REGISTERED'" # noqa: S608, E501
            await self.session.execute(text(sql_winners), params)

        if waitlist:
            placeholders = ", ".join(
                (f"(:lid_{i}, CAST(:lrank_{i} AS INTEGER), CAST(:lpos_{i} AS INTEGER))")
                for i in range(len(waitlist))
            )
            params = {"now": now}
            for i, (lid, rank, position) in enumerate(waitlist):
                params[f"lid_{i}"] = lid
                params[f"lrank_{i}"] = rank
                params[f"lpos_{i}"] = position
            sql_waitlist = f"UPDATE registrations AS r SET status = 'WAITLISTED', lottery_rank = v.rank, waitlist_position = v.position, updated_at =:now FROM (VALUES {placeholders}) AS v(id, rank, position) WHERE r.id = v.id AND r.status = 'REGISTERED'" # noqa: S608, E501
            await self.session.execute(text(sql_waitlist), params)

        if losers:
            await self.session.execute(
                update(Registration)
                .where(Registration.id.in_(losers))
                .where(Registration.status == "REGISTERED")
                .values(status="LOST", updated_at=now)
            )

        await self.session.flush()
