"""ticket 模組 repository — 只此模組可直接存取 tickets 表"""

from datetime import datetime

from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.modules.ticket.errors import TicketAlreadyIssuedError
from app.modules.ticket.models import Ticket


class TicketRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_or_raise(
        self,
        *,
        ticket_id: str,
        registration_id: str,
        user_id: str,
        session_id: str,
    ) -> Ticket:
        """:reg/ticket 回 1:1。UNIQUE(registration_id, ticket_seq=0) 等同
        UNIQUE(registration_id) — 同 reg 只能一張 ticket。

        ticket_seq / holder_name / holder_relationship 欄位仍存在(0011 cleanup
        前不 DROP)— 不寫入,DB server_default(0/NULL/NULL)讓 CHECK 通過。
        """
        now = now_utc()
        ticket = Ticket(
            id=ticket_id,
            registration_id=registration_id,
            user_id=user_id,
            session_id=session_id,
            status="ISSUED",
            issued_at=now,
            created_at=now,
            updated_at=now,
        )
        self.session.add(ticket)
        try:
            await self.session.flush()
        except IntegrityError as e:
            raise TicketAlreadyIssuedError("此 registration 已發過票券") from e
        return ticket

    async def get_by_id(self, ticket_id: str) -> Ticket | None:
        result = await self.session.execute(select(Ticket).where(Ticket.id == ticket_id))
        return result.scalar_one_or_none()

    async def get_by_registration(self, registration_id: str) -> Ticket | None:
        """:reg/ticket 1:1,回該 reg 的 ticket(若存在)"""
        result = await self.session.execute(
            select(Ticket).where(Ticket.registration_id == registration_id)
        )
        return result.scalar_one_or_none()

    async def get_status_and_used_at(self, ticket_id: str) -> tuple[str, datetime | None] | None:
        """verify 失敗備援查詢 — 只取 status / used_at 兩欄(避免拉整個 row)"""
        result = await self.session.execute(
            select(Ticket.status, Ticket.used_at).where(Ticket.id == ticket_id)
        )
        row = result.first()
        if row is None:
            return None
        return (str(row.status), row.used_at)

    async def list_by_user(
        self,
        user_id: str,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Ticket], int]:
        base = select(Ticket).where(Ticket.user_id == user_id)
        if status:
            base = base.where(Ticket.status == status)
        total_q = select(func.count()).select_from(base.subquery())
        total = int((await self.session.execute(total_q)).scalar_one())
        page_q = base.order_by(Ticket.issued_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(page_q)
        return list(result.scalars().all()), total

    async def atomic_verify_and_use(
        self,
        ticket_id: str,
        device_id: str,
    ) -> tuple[str, str, datetime] | None:
        """:回 1:1 — RETURNING 簡化為 3-tuple(user_id, session_id, used_at)。

         持票人姓名由 verify_and_use_ticket service 端反查 user.name 決定
        (員工 → 員工名;DEPENDENT user → 眷屬名),不靠 ticket 上的 holder_*。
        """
        now = now_utc()
        result = await self.session.execute(
            update(Ticket)
            .where(and_(Ticket.id == ticket_id, Ticket.status == "ISSUED"))
            .values(
                status="USED",
                used_at=now,
                used_by_device=device_id,
                updated_at=now,
            )
            .returning(Ticket.user_id, Ticket.session_id, Ticket.used_at)
        )
        await self.session.flush()
        row = result.first()
        if row is None:
            return None
        return (str(row.user_id), str(row.session_id), row.used_at)

    async def list_by_session(self, session_id: str, *, status: str | None = None) -> list[Ticket]:
        """跨 session 列票券 — admin / event_cancelled flow 用"""
        stmt = select(Ticket).where(Ticket.session_id == session_id)
        if status:
            stmt = stmt.where(Ticket.status == status)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_session_status(self, session_id: str) -> dict[str, int]:
        """場次入場統計(設計 06 §10.3 admin 用 — issued/used/revoked)"""
        result = await self.session.execute(
            select(Ticket.status, func.count(Ticket.id))
            .where(Ticket.session_id == session_id)
            .group_by(Ticket.status)
        )
        return {status: int(count) for status, count in result.all()}

    async def bulk_revoke_by_session_ids(
        self,
        session_ids: list[str],
        reason: str,
    ) -> tuple[int, list[str]]:
        """活動取消批次撤銷(設計 §10.8)— 只動 ISSUED 狀態,USED/REVOKED 不變。

        回傳 (撤票數, 受影響 user_id list);用 RETURNING 在同一語句拿 user_id,
        避免 commit 後另一次 SELECT 會撈到歷史 REVOKED 票主(future-proof,
        未來若有個別撤票路徑時不會誤通知)。
        """
        if not session_ids:
            return 0, []
        now = now_utc()
        result = await self.session.execute(
            update(Ticket)
            .where(
                and_(
                    Ticket.session_id.in_(session_ids),
                    Ticket.status == "ISSUED",
                )
            )
            .values(
                status="REVOKED",
                revoked_at=now,
                revoke_reason=reason,
                updated_at=now,
            )
            .returning(Ticket.user_id)
        )
        rows = result.scalars().all()
        await self.session.flush()
        user_ids = sorted({str(uid) for uid in rows})
        return len(rows), user_ids
