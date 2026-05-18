"""lottery 模組 Service — Fisher-Yates with HMAC-SHA256 derived RNG

對齊設計 06 §9。提供 LotteryServiceProtocol 跨模組介面;透過建構子注入
EventServiceProtocol + RegistrationServiceProtocol(設計 §7.3)。

關鍵不變式(.md §3):
- **演算法**:Fisher-Yates,以 seed + counter 透過 SHA-256 推導 RNG。**不可用 Python random**
- **冪等保證由 DB 提供**:lottery_records UNIQUE(session_id, ticket_type_id)
- **相同輸入必產生相同結果**(FR-LOT-09)
- **候補上限**:`min(len(shuffled) - quota, quota)` — 不超過配額
"""

import hashlib
import secrets
import struct
import time
from collections.abc import Sequence
from datetime import timedelta
from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.events import LotteryCompleted, event_bus
from app.core.logging import get_logger
from app.core.metrics import LOTTERY_DURATION_SECONDS
from app.core.time import now_utc
from app.modules.event.service import EventServiceProtocol
from app.modules.lottery.errors import (
    LotteryAlreadyExecutedError,
    LotteryRecordNotFoundError,
    LotteryReplayMismatchError,
    SessionNotFoundError,
)
from app.modules.lottery.models import (
    ALGORITHM_VERSION as _ALG_V,
)
from app.modules.lottery.models import LotteryRecord as LotteryRecordORM
from app.modules.lottery.repository import LotteryRepository
from app.modules.registration.service import RegistrationServiceProtocol
from app.shared.lottery_ref import (
    LotteryRecord,
    LotteryReplayResult,
    LotteryResult,
    TicketTypeLotteryResult,
)
from app.shared.registration_ref import RegistrationRef

logger = get_logger(__name__)

# 對外 re-export(future v2 只改 models.py 一處)
ALGORITHM_VERSION = _ALG_V


@runtime_checkable
class LotteryServiceProtocol(Protocol):
    """跨模組呼叫介面(對齊設計 06 §9.3)"""

    async def execute_lottery(self, session_id: str) -> LotteryResult:
        """對指定場次的所有票種抽籤;UNIQUE 衝突代表已抽過,直接回原紀錄"""
        ...

    async def get_lottery_record(
        self, session_id: str, ticket_type_id: str
    ) -> LotteryRecord | None:...

    async def replay_for_audit(self, session_id: str, ticket_type_id: str) -> LotteryReplayResult:
        """以原 seed 重跑抽籤,驗證結果一致(稽核用)"""
        ...


def _fisher_yates_shuffle(items: Sequence[str], seed: str) -> list[str]:
    """確定性洗牌 — 相同輸入(items + seed)必產生相同結果。

    用 SHA-256(seed + counter)推導每步亂數,跨平台/版本一致(Python random
    在不同 minor version 內部狀態可能變,故不能用)。

    **modulo bias 假設**:`r % (i+1)` 對 i ≤ 10^5 偏差在 2^-50 級可忽略;
    若候選人數突破百萬(企業大型抽獎情境),應改 rejection sampling
    (持續抽 r 直到 `r < (2^64 // (i+1)) * (i+1)`,丟棄 bias 區段)。
    當前 7-8 萬員工總量 < 10^5,本實作充分。
    """
    arr = list(items)
    n = len(arr)
    # Fisher-Yates 從尾端往前 swap;用 enumerate 拿到 counter 同時遞減 i
    for counter, i in enumerate(range(n - 1, 0, -1)):
        h = hashlib.sha256(f"{seed}:{counter}".encode()).digest()
        # 取前 8 bytes 當 64-bit unsigned int
        r = struct.unpack(">Q", h[:8])[0]
        j = r % (i + 1)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


class LotteryService:
    def __init__(
        self,
        session: AsyncSession,
        event_svc: EventServiceProtocol,
        registration_svc: RegistrationServiceProtocol,
    ) -> None:
        self.session = session
        self.event_svc = event_svc
        self.registration_svc = registration_svc
        self.repo = LotteryRepository(session)

    # 對外 Protocol 方法

    async def execute_lottery(self, session_id: str) -> LotteryResult:
        """ 兩階段抽籤(-13/24/26):
        1. 取 session(若已 COMPLETED 直接讀現有紀錄回)
        2. mark_lottery_running(若還沒)
        3. ticket_types 排序:audience='EMPLOYEE' 先,'DEPENDENT' 後
        4. EMP 階段 sequential 跑完(每筆 ticket_type 獨立 transaction、冪等)
        5. DEP 階段:從 EMP COMPLETED records 算 emp_remaining;quota = tt.quota + emp_remaining
        6. mark_lottery_completed(僅當所有 ticket_types 都 COMPLETED)
        """
        session_info = await self.event_svc.get_session(session_id)
        if session_info is None:
            raise SessionNotFoundError(f"場次不存在: {session_id}")

        already_completed = session_info.status == "LOTTERY_COMPLETED"

        if not already_completed:
            await self.event_svc.mark_lottery_running(session_id)

        #:EMP 先,DEP 後
        ticket_types_sorted = sorted(
            session_info.ticket_types,
            key=lambda t: (
                getattr(t, "audience", "EMPLOYEE") != "EMPLOYEE", # EMP first
                t.id,
            ),
        )

        results: list[TicketTypeLotteryResult] = []
        for tt in ticket_types_sorted:
            audience = getattr(tt, "audience", "EMPLOYEE")
            if audience == "DEPENDENT":
                # -13/27/43:DEP 階段從 EMP COMPLETED records 算 emp_remaining
                emp_remaining = await self.repo.calc_emp_remaining_for_session(session_id)
                dynamic_quota = tt.quota + emp_remaining
                ttr = await self._execute_for_ticket_type(
                    session_id=session_id,
                    ticket_type_id=tt.id,
                    quota=dynamic_quota,
                    quota_at_draw=dynamic_quota,
                    confirmation_deadline_hours=session_info.confirmation_deadline_hours,
                    emp_remaining_allocated=emp_remaining,
                )
            else:
                ttr = await self._execute_for_ticket_type(
                    session_id=session_id,
                    ticket_type_id=tt.id,
                    quota=tt.quota,
                    quota_at_draw=tt.quota,
                    confirmation_deadline_hours=session_info.confirmation_deadline_hours,
                )
            results.append(ttr)

        if not already_completed:
            await self.event_svc.mark_lottery_completed(session_id)
            # 每筆 ticket_type 取對應的 winners 名單寫進 audit;BR-09 要求個別員工
            # 狀態變更可追溯,bulk_apply_lottery 是批次 UPDATE 沒 per-row audit,
            # 由此處的 lottery audit 補完整 forensic 路徑
            ticket_type_audits = []
            for r in results:
                if not r.newly_executed:
                    continue
                winners_refs = await self.registration_svc.list_winners_for_audit(
                    session_id, r.ticket_type_id
                )
                ticket_type_audits.append(
                    {
                        "ticket_type_id": r.ticket_type_id,
                        "candidates": r.record.candidate_count,
                        "winners": r.record.winner_count,
                        "waitlist": r.record.waitlist_count,
                        "winner_ids": [w.id for w in winners_refs],
                        "seed_first8": r.record.seed[:8], # 不存全 seed 防滲漏
                    }
                )
            await audit(
                self.session,
                actor_id=None,
                actor_role="SYSTEM",
                action="lottery.execute",
                entity_type="session",
                entity_id=session_id,
                after={"ticket_types": ticket_type_audits},
            )
            await self.session.commit()

        #:publish LotteryCompleted 給 notification 模組(每 ticket_type 一次)
        # 失敗不擋主流程 — 抽籤已 commit
        if not already_completed:
            event_title = ""
            try:
                ev = await self.event_svc.get_event(session_info.event_id)
                if ev is not None:
                    event_title = ev.title
            except Exception:
                logger.exception("lottery_event_title_lookup_failed", session_id=session_id)
            for r in results:
                if not r.newly_executed:
                    continue
                try:
                    # 全修:依最新 status 取 winner / waitlist / loser
                    # (取代 階段「全放 loser_uids」簡化,避免 WAITLISTED
                    # 員工收到 LOTTERY_LOST 通知,違反 FR-NOTIF-06)
                    (
                        winner_uids,
                        waitlist_uids,
                        loser_uids,
                    ) = await self.registration_svc.list_lottery_outcome_user_ids(
                        session_id, r.ticket_type_id
                    )
                    deadline_iso = (
                        now_utc() + timedelta(hours=session_info.confirmation_deadline_hours)
                    ).isoformat()
                    await event_bus.publish(
                        LotteryCompleted(
                            session_id=session_id,
                            ticket_type_id=r.ticket_type_id,
                            event_title=event_title,
                            confirmation_deadline=deadline_iso,
                            winner_user_ids=winner_uids,
                            waitlist_user_ids=waitlist_uids,
                            loser_user_ids=loser_uids,
                        )
                    )
                except Exception:
                    logger.exception(
                        "lottery_publish_event_failed",
                        session_id=session_id,
                        ticket_type_id=r.ticket_type_id,
                    )

        logger.info(
            "lottery_execute_done",
            session_id=session_id,
            ticket_types=len(results),
            new_count=sum(1 for r in results if r.newly_executed),
        )
        return LotteryResult(session_id=session_id, ticket_types=results)

    async def get_lottery_record(
        self, session_id: str, ticket_type_id: str
    ) -> LotteryRecord | None:
        rec = await self.repo.get_record(session_id, ticket_type_id)
        return _to_dto(rec) if rec else None

    async def replay_for_audit(self, session_id: str, ticket_type_id: str) -> LotteryReplayResult:
        """用既存 seed 重跑 → 跟 registrations 現存 winner 名單比對(設計 §9.5)。

        分兩段比對(設計 補強):
        - **集合等價**:winners 一致(誰中) — 不一致 = 「換人中」
        - **順序等價**:lottery_rank 一致(中的順序) — 不一致 = 「改 rank」
        兩者皆不一致 → raise LotteryReplayMismatchError
        """
        rec = await self.repo.get_record(session_id, ticket_type_id)
        if rec is None:
            raise LotteryRecordNotFoundError(f"找不到抽籤紀錄: {session_id}/{ticket_type_id}")

        # 取候選人(同 execute_lottery 入口排序)
        candidates = await self._fetch_candidates(session_id, ticket_type_id)
        candidate_ids = [c.id for c in candidates]

        # 重跑 Fisher-Yates
        shuffled = _fisher_yates_shuffle(candidate_ids, rec.seed)

        # 取現存 winner 名單(精準 query — by ticket_type + WON,by lottery_rank ASC)
        actual_winners = await self.registration_svc.list_winners_for_audit(
            session_id, ticket_type_id
        )
        actual_winner_ids = [r.id for r in actual_winners]

        # 重跑的 winner 是 shuffled[:winner_count]
        replayed_winner_ids = shuffled[: rec.winner_count]

        # 集合 vs 順序兩段
        set_equal = set(actual_winner_ids) == set(replayed_winner_ids)
        order_equal = actual_winner_ids == replayed_winner_ids

        if not set_equal:
            raise LotteryReplayMismatchError(
                f"replay 不一致(集合不同 = 換人中): {session_id}/{ticket_type_id}"
            )
        if not order_equal:
            raise LotteryReplayMismatchError(
                f"replay 不一致(順序不同 = 改 rank): {session_id}/{ticket_type_id}"
            )

        return LotteryReplayResult(
            session_id=session_id,
            ticket_type_id=ticket_type_id,
            matches=True,
            original_winners=actual_winner_ids,
            replayed_winners=replayed_winner_ids,
        )

    # Internal

    async def _execute_for_ticket_type(
        self,
        *,
        session_id: str,
        ticket_type_id: str,
        quota: int,
        quota_at_draw: int,
        confirmation_deadline_hours: int,
        emp_remaining_allocated: int = 0,
    ) -> TicketTypeLotteryResult:
        """:單一 ticket_type 抽籤(-25/27)。

        1. INSERT lottery_records status='RUNNING' + quota_at_draw / emp_remaining_allocated
           (UNIQUE 衝突 → race fallback)
        2. 取候選人 + Fisher-Yates + 切 winners/waitlist/losers(回筆計)
        3. apply_lottery_results 寫 registrations
        4. mark_record_completed:同 transaction 寫 winner_count + status='COMPLETED'(-25)
        """
        seed = secrets.token_hex(32) # 256-bit
        try:
            record = await self.repo.create_record_or_raise(
                session_id=session_id,
                ticket_type_id=ticket_type_id,
                seed=seed,
                quota_at_draw=quota_at_draw,
                emp_remaining_allocated=emp_remaining_allocated,
            )
        except LotteryAlreadyExecutedError:
            await self.session.rollback()
            existing = await self.repo.get_record(session_id, ticket_type_id)
            if existing is None:
                raise
            #:撞 UNIQUE 後依 status 分流
            if str(existing.status) == "COMPLETED":
                logger.info(
                    "lottery_race_fallback_to_existing_completed",
                    session_id=session_id,
                    ticket_type_id=ticket_type_id,
                    existing_record_id=existing.id,
                )
                return TicketTypeLotteryResult(
                    ticket_type_id=ticket_type_id,
                    record=_to_dto(existing),
                    newly_executed=False,
                )
            # RUNNING 殘留(crash recovery)— 用既有 seed 接管 reseed,寫入後完成
            logger.warning(
                "lottery_running_record_resume",
                session_id=session_id,
                ticket_type_id=ticket_type_id,
                existing_record_id=existing.id,
            )
            record = existing
            seed = str(existing.seed)

        start_ms = time.monotonic()
        candidates = await self._fetch_candidates(session_id, ticket_type_id)
        candidate_ids = [c.id for c in candidates]
        shuffled = _fisher_yates_shuffle(candidate_ids, seed)

        #:配額回「以筆計」(reg/ticket 1:1)
        winners: list[tuple[str, int]] = [
            (reg_id, i + 1) for i, reg_id in enumerate(shuffled[:quota])
        ]
        waitlist_count = max(0, min(len(shuffled) - quota, quota))
        waitlist: list[tuple[str, int, int]] = [
            (reg_id, i + 1 + quota, i + 1)
            for i, reg_id in enumerate(shuffled[quota: quota + waitlist_count])
        ]
        losers = list(shuffled[quota + waitlist_count:])

        deadline = now_utc() + timedelta(hours=confirmation_deadline_hours)

        #:apply_lottery_results + mark_record_completed
        # 用 SAVEPOINT 包,任一失敗整段 rollback。否則:reg.bulk_apply_lottery
        # 已把 candidates 改成 WON/WAITLISTED/LOST,但 mark_record_completed 失敗
        # → record.status 仍是 RUNNING,下次 reconcile 撈候選 SQL 用 status='REGISTERED'
        # 撈到 0 筆(因為已被前次 update 走),winners 結果不同 → replay 必 mismatch。
        # SAVEPOINT 失敗則 reg 維持 REGISTERED,record 維持 RUNNING,下次重抽結果一致。
        duration_ms = 0
        async with self.session.begin_nested():
            await self.registration_svc.apply_lottery_results(
                session_id=session_id,
                ticket_type_id=ticket_type_id,
                winners=winners,
                waitlist=waitlist,
                losers=losers,
                confirmation_deadline=deadline,
            )

            duration_ms = int((time.monotonic() - start_ms) * 1000)
            #:winner_count + status='COMPLETED' 同一 UPDATE
            await self.repo.mark_record_completed(
                record.id,
                candidate_count=len(candidates),
                winner_count=len(winners),
                waitlist_count=len(waitlist),
                duration_ms=duration_ms,
            )

        bucket = "small" if quota < 10 else "medium" if quota < 100 else "large"
        LOTTERY_DURATION_SECONDS.labels(quota_bucket=bucket).observe(duration_ms / 1000)

        await self.session.refresh(record)
        return TicketTypeLotteryResult(
            ticket_type_id=ticket_type_id,
            record=_to_dto(record),
            newly_executed=True,
        )

    async def _fetch_candidates(
        self, session_id: str, ticket_type_id: str
    ) -> list[RegistrationRef]:
        """取 status='REGISTERED' 候選人。Repository 已 ORDER BY created_at ASC,
        在 candidate_ids 同個值下 Fisher-Yates 結果就確定。
        """
        return await self.registration_svc.list_registered_for_lottery(session_id, ticket_type_id)


def _to_dto(orm: LotteryRecordORM) -> LotteryRecord:
    return LotteryRecord(
        id=orm.id,
        session_id=orm.session_id,
        ticket_type_id=orm.ticket_type_id,
        seed=orm.seed,
        candidate_count=orm.candidate_count,
        winner_count=orm.winner_count,
        waitlist_count=orm.waitlist_count,
        algorithm_version=orm.algorithm_version,
        executed_at=orm.executed_at,
        duration_ms=orm.duration_ms,
    )
