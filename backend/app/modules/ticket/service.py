"""ticket 模組 Service — 確認中籤 + 發券 + QR 簽 + 核銷 + 撤銷

對齊設計 06 §10。提供 TicketServiceProtocol 跨模組介面。
透過建構子注入 EventServiceProtocol + RegistrationServiceProtocol(設計 §7.3)。

關鍵不變式(.md §6):
- **核銷必為單一 SQL**:`UPDATE... WHERE id=? AND status='ISSUED' RETURNING...`
- **QR JWT EdDSA + 60 秒過期**(設計 §10.6)
- **30 分鐘窗**:`starts_at - 30min ≤ NOW ≤ ends_at + 30min`(BR-07 / FR-TKT-09)
- **跨模組原子例外**:confirm + ticket INSERT 同 transaction(設計 §5.4)
"""

from datetime import timedelta
from typing import Any, Protocol, runtime_checkable

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.events import EventCancelled, event_bus
from app.core.logging import get_logger
from app.core.metrics import (
    TICKET_ISSUED_TOTAL,
    TICKET_REVOKED_TOTAL,
    TICKET_VERIFIED_TOTAL,
)
from app.core.qr_signer import QRSigner
from app.core.time import now_utc
from app.core.ulid import generate_ulid
from app.modules.auth.service import AuthServiceProtocol
from app.modules.event.service import EventServiceProtocol
from app.modules.registration.errors import (
    CannotForfeitError,
)
from app.modules.registration.service import RegistrationServiceProtocol
from app.modules.ticket.errors import (
    ConfirmationExpiredError,
    EventEndedError,
    EventNotStartedError,
    TicketAlreadyIssuedError,
    TicketAlreadyUsedError,
    TicketInvalidError,
    TicketNotFoundError,
    TicketRevokedError,
)
from app.modules.ticket.models import Ticket as TicketORM
from app.modules.ticket.repository import TicketRepository
from app.shared.enums import TicketStatus
from app.shared.ticket_ref import (
    AttendanceStats,
    TicketDetail,
    TicketSummary,
    TicketWithQRPayload,
    VerificationResult,
)

logger = get_logger(__name__).bind(component="ticket")

_VERIFY_WINDOW = timedelta(minutes=30)


@runtime_checkable
class TicketServiceProtocol(Protocol):
    """跨模組呼叫介面(對齊設計 06 §10.3)"""

    async def get_ticket_by_registration(self, registration_id: str) -> TicketDetail | None:...

    async def list_tickets_by_user(
        self,
        user_id: str,
        status: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[TicketSummary], int]:...

    async def count_attendance(self, session_id: str) -> AttendanceStats:...

    async def revoke_tickets_by_event_cancelled(
        self,
        event_id: str,
        reason: str,
        *,
        actor_id: str | None = None,
        actor_role: str = "SYSTEM",
    ) -> int:
        """ 全修:admin_svc.cancel_event 後呼叫,
        bulk 撤銷該活動所有 ISSUED 票券 + publish EventCancelled 給 notification。
        """
        ...


class TicketService:
    def __init__(
        self,
        session: AsyncSession,
        event_svc: EventServiceProtocol,
        registration_svc: RegistrationServiceProtocol,
        qr_signer: QRSigner | None = None,
        auth_svc: "AuthServiceProtocol | None" = None,
    ) -> None:
        """:auth_svc 可選注入(verify_and_use_ticket 反查持票人姓名用)。

        qr_signer 可選 —:admin 只需 count_attendance 等
        stats path,不需簽 QR。caller 不傳代表不能走 sign_ticket / verify_ticket。
        """
        self.session = session
        self.event_svc = event_svc
        self.registration_svc = registration_svc
        self.qr_signer: QRSigner | None = qr_signer
        self.auth_svc = auth_svc
        self.repo = TicketRepository(session)

    def _require_qr_signer(self) -> QRSigner:
        """需 QR 簽章的方法呼叫此 helper;若 caller 沒注入會 raise"""
        if self.qr_signer is None:
            raise RuntimeError("TicketService 建構時未提供 qr_signer,無法執行需簽章 / 驗章的方法")
        return self.qr_signer

    # 員工端

    async def confirm_registration_and_issue_ticket(
        self,
        *,
        registration_id: str,
        user_id: str,
        user_role: str,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> TicketDetail:
        """確認中籤並發券(:ownership-aware lock)。

        :reg/ticket 回 1:1。eng 自報 → reg.user_id=員工;代報眷屬 → reg.user_id=眷屬
        (DEPENDENT user)。confirm 時用 lock_owned_for_confirmation 同時擋越權。

        於同一 transaction 內:
          1. ownership-aware SELECT FOR UPDATE
          2. 驗 status='WON' / deadline 未到
          3. UPDATE registrations.status='CONFIRMED'
          4. INSERT 1 張 ticket(reg.user_id 直接用 — 員工或眷屬)
          5. commit
        """
        # 1.:ownership-aware lock
        reg = await self.registration_svc.lock_owned_for_confirmation(
            registration_id, user_id, self.session
        )

        if reg.status != "WON":
            raise CannotForfeitError(f"目前狀態為 {reg.status},只有 WON 狀態可確認")
        if reg.confirmation_deadline is None or reg.confirmation_deadline < now_utc():
            raise ConfirmationExpiredError("確認期限已過")

        # 2. UPDATE registrations
        await self.registration_svc.mark_confirmed_in_session(registration_id, self.session)

        # 3. INSERT ticket — user_id = reg.user_id(員工自報用員工 id;代報用眷屬 id)
        ticket_id = generate_ulid()
        ticket = await self.repo.create_or_raise(
            ticket_id=ticket_id,
            registration_id=registration_id,
            user_id=reg.user_id,
            session_id=reg.session_id,
        )

        # 4. audit + commit
        await audit(
            self.session,
            actor_id=user_id, # 操作者仍是員工
            actor_role=user_role,
            action="ticket.confirm_and_issue",
            entity_type="ticket",
            entity_id=ticket_id,
            after={
                "registration_id": registration_id,
                "session_id": reg.session_id,
                "status": "ISSUED",
                "holder_user_id": reg.user_id,
                "as_dependent_id": reg.as_dependent_id,
            },
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()

        TICKET_ISSUED_TOTAL.inc()
        logger.info(
            "ticket_issued",
            ticket_id=ticket_id,
            registration_id=registration_id,
            holder_user_id=reg.user_id,
        )
        return _to_detail(ticket)

    async def get_ticket_with_qr(self, ticket_id: str, user_id: str) -> TicketWithQRPayload:
        """員工拿自己的票 + 當下產 QR JWT(60 秒)"""
        ticket = await self.repo.get_by_id(ticket_id)
        if ticket is None or ticket.user_id != user_id:
            # 越權當 NotFound 防探測
            raise TicketNotFoundError("票券不存在")
        if ticket.status != "ISSUED":
            # USED/REVOKED 也回 detail 但不出 QR(讓 caller 看 status 處理)
            raise TicketInvalidError(f"票券狀態為 {ticket.status},無法產 QR")

        token, expires_at = self._require_qr_signer().sign_ticket(
            ticket_id=ticket.id,
            user_id=ticket.user_id,
            session_id=ticket.session_id,
        )
        return TicketWithQRPayload(
            ticket=_to_detail(ticket),
            qr_payload=token,
            qr_expires_at=expires_at,
        )

    # 驗票員端

    async def verify_and_use_ticket(
        self,
        *,
        qr_payload: str,
        device_id: str,
        verifier_id: str,
        request_id: str | None = None,
    ) -> VerificationResult:
        """驗票核銷(設計 06 §10.7, R4 後優化):

        1. 驗 JWT 簽章 + exp;失敗 raise TicketInvalidError
        2. 30 分鐘 boundary check(BR-07)— 用 JWT claim 內已簽過的 sid 查 session,
           不通過直接 raise,**省一次無效 UPDATE+WAL+rollback**
        3. 原子 UPDATE WHERE status='ISSUED'
        4. RETURNING 空 → 撈實際 status(只取 status / used_at)拋對應 error
        5. audit + commit
        """
        # 1. 驗 JWT
        try:
            claims: dict[str, Any] = self._require_qr_signer().verify_ticket_payload(qr_payload)
        except jwt.InvalidTokenError as e:
            logger.warning("ticket_qr_invalid", error=str(e))
            TICKET_VERIFIED_TOTAL.labels(outcome="invalid_jwt").inc()
            raise TicketInvalidError("QR Code 無效或已過期") from e

        ticket_id = claims.get("tid")
        if not ticket_id or not isinstance(ticket_id, str):
            TICKET_VERIFIED_TOTAL.labels(outcome="invalid_jwt").inc()
            raise TicketInvalidError("QR Code 缺 tid")
        claim_session_id = claims.get("sid")
        if not claim_session_id or not isinstance(claim_session_id, str):
            TICKET_VERIFIED_TOTAL.labels(outcome="invalid_jwt").inc()
            raise TicketInvalidError("QR Code 缺 sid")

        # 2. 活動時間 boundary 先擋(BR-07 + FR-TKT-09):
        # starts_at - 30min ≤ NOW ≤ ends_at + 30min。
        # 用 JWT 簽過的 sid(可信),失敗直接 raise,省去後續 UPDATE+rollback。
        session_info = await self.event_svc.get_session(claim_session_id)
        if session_info is None:
            # session 不存在(理論上不該發生 — 取消活動只改 status 不刪 session)
            # 為避免 BR-07 時段檢查被靜默繞過,直接視為 invalid
            TICKET_VERIFIED_TOTAL.labels(outcome="invalid_jwt").inc()
            raise TicketInvalidError("QR Code 對應場次不存在")
        now = now_utc()
        if now < session_info.starts_at - _VERIFY_WINDOW:
            TICKET_VERIFIED_TOTAL.labels(outcome="out_of_window").inc()
            raise EventNotStartedError("活動尚未開始,請於開場前 30 分鐘再來")
        if now > session_info.ends_at + _VERIFY_WINDOW:
            TICKET_VERIFIED_TOTAL.labels(outcome="out_of_window").inc()
            raise EventEndedError("活動已結束 30 分鐘以上,無法核銷")

        # 3. 原子核銷
        used_row = await self.repo.atomic_verify_and_use(ticket_id, device_id)

        # 4. 失敗時撈實際狀態判斷錯因(只讀 status / used_at,不撈整 row)
        if used_row is None:
            status_info = await self.repo.get_status_and_used_at(ticket_id)
            if status_info is None:
                TICKET_VERIFIED_TOTAL.labels(outcome="not_found").inc()
                raise TicketInvalidError("票券不存在")
            status, used_at_existing = status_info
            if status == "USED":
                TICKET_VERIFIED_TOTAL.labels(outcome="already_used").inc()
                raise TicketAlreadyUsedError(f"票券已使用過(於 {used_at_existing})")
            if status == "REVOKED":
                TICKET_VERIFIED_TOTAL.labels(outcome="revoked").inc()
                raise TicketRevokedError("票券已撤銷")
            # 理論上不會走到這裡
            TICKET_VERIFIED_TOTAL.labels(outcome="invalid_jwt").inc()
            raise TicketInvalidError(f"票券狀態為 {status},無法核銷")

        used_user_id, used_session_id, used_at = used_row

        # 5. audit + commit
        await audit(
            self.session,
            actor_id=verifier_id,
            actor_role="VERIFIER",
            action="ticket.verify_use",
            entity_type="ticket",
            entity_id=ticket_id,
            before={"status": "ISSUED"},
            after={
                "status": "USED",
                "used_by_device": device_id,
                "user_id": used_user_id,
            },
            request_id=request_id,
        )
        await self.session.commit()

        TICKET_VERIFIED_TOTAL.labels(outcome="success").inc()

        # 6.:取持票人姓名 — user.name(EMPLOYEE 或 DEPENDENT user 都通用)
        user_name: str | None = None
        try:
            user_detail_or_dep = None
            # 優先用 auth_svc 反查 user.name(EMPLOYEE / DEPENDENT 都同一張表)
            if hasattr(self, "auth_svc") and self.auth_svc is not None:
                user_detail_or_dep = await self.auth_svc.get_user_by_id(used_user_id)
            if user_detail_or_dep is not None:
                user_name = user_detail_or_dep.name
        except Exception:
            logger.exception("verify_ticket_user_name_lookup_failed", ticket_id=ticket_id)

        return VerificationResult(
            ticket_id=ticket_id,
            user_id=used_user_id,
            session_id=used_session_id,
            used_at=used_at,
            user_name=user_name,
        )

    # 跨模組 Protocol 方法

    async def get_ticket_by_registration(self, registration_id: str) -> TicketDetail | None:
        ticket = await self.repo.get_by_registration(registration_id)
        return _to_detail(ticket) if ticket else None

    async def list_tickets_by_user(
        self,
        user_id: str,
        status: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[TicketSummary], int]:
        offset = (page - 1) * page_size
        rows, total = await self.repo.list_by_user(
            user_id, status=status, offset=offset, limit=page_size
        )
        return [_to_summary(t) for t in rows], total

    async def count_attendance(self, session_id: str) -> AttendanceStats:
        counts = await self.repo.count_by_session_status(session_id)
        return AttendanceStats(
            session_id=session_id,
            issued=counts.get("ISSUED", 0),
            used=counts.get("USED", 0),
            revoked=counts.get("REVOKED", 0),
        )

    # admin / event_bus stub

    async def revoke_tickets_by_event_cancelled(
        self,
        event_id: str,
        reason: str,
        *,
        actor_id: str | None = None,
        actor_role: str = "SYSTEM",
    ) -> int:
        """活動取消後批次撤銷該活動所有 ISSUED 票券(設計 §10.8)。

         event_bus 上線後接 EventCancelled 事件(actor_id=None / SYSTEM);
         admin 手動呼叫時傳實際 admin id 與 ADMIN role,以利 audit 追蹤。
        """
        # 從 event 撈所有 session_id
        ev_detail = await self.event_svc.get_event(event_id)
        if ev_detail is None:
            return 0
        session_ids = [s.id for s in ev_detail.sessions]
        if not session_ids:
            return 0
        revoked, affected_user_ids = await self.repo.bulk_revoke_by_session_ids(session_ids, reason)
        if revoked > 0:
            await audit(
                self.session,
                actor_id=actor_id,
                actor_role=actor_role,
                action="ticket.bulk_revoke",
                entity_type="event",
                entity_id=event_id,
                after={"reason": reason, "revoked_count": revoked},
            )
            await self.session.commit()
            reason_kind = "admin_manual" if actor_role == "ADMIN" else "event_cancelled"
            TICKET_REVOKED_TOTAL.labels(reason_kind=reason_kind).inc(revoked)
            logger.info(
                "tickets_bulk_revoked",
                event_id=event_id,
                revoked=revoked,
                actor_id=actor_id,
            )
            # affected_user_ids 由 bulk_revoke 的 RETURNING 取得,只含本次撤銷
            # 的 user_ids(避免歷史 REVOKED 票主被誤通知)
            try:
                await event_bus.publish(
                    EventCancelled(
                        event_id=event_id,
                        event_title=ev_detail.title,
                        reason=reason,
                        affected_user_ids=affected_user_ids,
                    )
                )
            except Exception:
                logger.exception("event_cancelled_publish_failed", event_id=event_id)
        return revoked


def _to_detail(orm: TicketORM) -> TicketDetail:
    return TicketDetail(
        id=orm.id,
        registration_id=orm.registration_id,
        user_id=orm.user_id,
        session_id=orm.session_id,
        status=TicketStatus(orm.status),
        issued_at=orm.issued_at,
        used_at=orm.used_at,
        used_by_device=orm.used_by_device,
        revoked_at=orm.revoked_at,
        revoke_reason=orm.revoke_reason,
    )


def _to_summary(orm: TicketORM) -> TicketSummary:
    return TicketSummary(
        id=orm.id,
        session_id=orm.session_id,
        status=TicketStatus(orm.status),
        issued_at=orm.issued_at,
        used_at=orm.used_at,
    )


__all__ = [
    "TicketAlreadyIssuedError",
    "TicketService",
    "TicketServiceProtocol",
]
