"""lottery 模組 repository — 只此模組可直接存取 lottery_records 表

 改動:
- create_record_or_raise 加 status='RUNNING' / quota_at_draw 參數(-25/27)
- 新 mark_record_completed:同 transaction 寫 winner_count + status='COMPLETED'(-25)
- _calc_emp_remaining_for_session:從 EMP records 算回剩餘配額(-13/27/43)
"""

from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.core.ulid import generate_ulid
from app.modules.lottery.errors import LotteryAlreadyExecutedError
from app.modules.lottery.models import ALGORITHM_VERSION, LotteryRecord


class LotteryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_record_or_raise(
        self,
        *,
        session_id: str,
        ticket_type_id: str,
        seed: str,
        quota_at_draw: int,
        algorithm_version: str = ALGORITHM_VERSION,
        emp_remaining_allocated: int = 0,
    ) -> LotteryRecord:
        """:INSERT status='RUNNING';抽完 caller 用 mark_record_completed
        同 transaction 寫 winner_count 並改 status='COMPLETED'。

        UNIQUE(session_id, ticket_type_id) 衝突代表已抽過 — caller 撞到應 SELECT
        現有 record,依 status 分流(COMPLETED → idempotent skip;RUNNING → 接管 reseed)。
        """
        record = LotteryRecord(
            id=generate_ulid(),
            session_id=session_id,
            ticket_type_id=ticket_type_id,
            seed=seed,
            candidate_count=0,
            winner_count=0,
            waitlist_count=0,
            algorithm_version=algorithm_version,
            status="RUNNING",
            quota_at_draw=quota_at_draw,
            emp_remaining_allocated=emp_remaining_allocated,
            executed_at=now_utc(),
            duration_ms=0,
        )
        self.session.add(record)
        try:
            await self.session.flush()
        except IntegrityError as e:
            raise LotteryAlreadyExecutedError("此場次此票種已抽過") from e
        return record

    async def get_record(self, session_id: str, ticket_type_id: str) -> LotteryRecord | None:
        result = await self.session.execute(
            select(LotteryRecord).where(
                LotteryRecord.session_id == session_id,
                LotteryRecord.ticket_type_id == ticket_type_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_records_for_session(self, session_id: str) -> list[LotteryRecord]:
        """reconcile / _calc_emp_remaining 用"""
        result = await self.session.execute(
            select(LotteryRecord).where(LotteryRecord.session_id == session_id)
        )
        return list(result.scalars().all())

    async def mark_record_completed(
        self,
        record_id: str,
        *,
        candidate_count: int,
        winner_count: int,
        waitlist_count: int,
        duration_ms: int,
    ) -> None:
        """:寫 counts + status='COMPLETED' 同一 UPDATE。"""
        result = await self.session.execute(
            update(LotteryRecord)
            .where(LotteryRecord.id == record_id)
            .values(
                candidate_count=candidate_count,
                winner_count=winner_count,
                waitlist_count=waitlist_count,
                duration_ms=duration_ms,
                status="COMPLETED",
            )
        )
        await self.session.flush()
        rowcount = getattr(result, "rowcount", -1)
        if rowcount == 0:
            raise RuntimeError(
                f"lottery_records 紀錄 {record_id} mark_completed 0 rows — 已被外部刪除?"
            )

    async def calc_emp_remaining_for_session(self, session_id: str) -> int:
        """/27/43:從 EMP audience 的 COMPLETED records 算剩餘配額。

        SUM(GREATEST(0, quota_at_draw - winner_count)) 跨所有 EMP ticket_types。
        DEP 階段抽籤時用此值動態加入 quota。

        :不 import event.models(跨模組);用原始 SQL JOIN ticket_types 表。
        """
        result = await self.session.execute(
            text(
                """
                SELECT COALESCE(SUM(GREATEST(0, lr.quota_at_draw - lr.winner_count)), 0)
                FROM lottery_records lr
                JOIN ticket_types tt ON tt.id = lr.ticket_type_id
                WHERE lr.session_id =:sid
                  AND lr.status = 'COMPLETED'
                  AND tt.audience = 'EMPLOYEE'
                """
            ).bindparams(sid=session_id)
        )
        return int(result.scalar_one() or 0)

    # 向後相容 alias(若 lottery_runner / 其他 caller 還在用舊名)
    async def update_record_counts(
        self,
        record_id: str,
        *,
        candidate_count: int,
        winner_count: int,
        waitlist_count: int,
        duration_ms: int,
    ) -> None:
        """舊 API 別名 → mark_record_completed()"""
        await self.mark_record_completed(
            record_id,
            candidate_count=candidate_count,
            winner_count=winner_count,
            waitlist_count=waitlist_count,
            duration_ms=duration_ms,
        )
