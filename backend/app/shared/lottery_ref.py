"""跨模組共用 lottery DTO(設計 06 §13.2)"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LotteryRecord(BaseModel):
    """單次抽籤的稽核紀錄(對齊 04 §4.8)"""

    model_config = ConfigDict(frozen=True)

    id: str
    session_id: str
    ticket_type_id: str
    seed: str
    candidate_count: int
    winner_count: int
    waitlist_count: int
    algorithm_version: str
    executed_at: datetime
    duration_ms: int


class TicketTypeLotteryResult(BaseModel):
    """抽籤後 per-ticket-type 結果(LotteryRecord + 是否新抽 vs 既有)"""

    model_config = ConfigDict(frozen=True)

    ticket_type_id: str
    record: LotteryRecord
    newly_executed: bool # True = 本次抽籤;False = 已存在(冪等命中)


class LotteryResult(BaseModel):
    """整場次的抽籤結果(設計 06 §9.5)"""

    model_config = ConfigDict(frozen=True)

    session_id: str
    ticket_types: list[TicketTypeLotteryResult]


class LotteryReplayResult(BaseModel):
    """replay_for_audit 回傳 — 重跑同 seed 是否與原結果一致"""

    model_config = ConfigDict(frozen=True)

    session_id: str
    ticket_type_id: str
    matches: bool
    original_winners: list[str]
    replayed_winners: list[str]
