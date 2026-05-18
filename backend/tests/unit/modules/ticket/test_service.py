"""confirm + verify_and_use 流程 — 跨模組原子 + 雙重核銷防擋 + 30 分鐘 boundary"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.registration.errors import (
    CannotForfeitError,
    RegistrationNotFoundError,
)
from app.modules.ticket.errors import (
    ConfirmationExpiredError,
    EventEndedError,
    EventNotStartedError,
    TicketAlreadyIssuedError,
    TicketAlreadyUsedError,
    TicketInvalidError,
    TicketRevokedError,
)
from app.modules.ticket.service import TicketService


def _reg_detail(
    *,
    user_id: str = "01HUUXXXXXXXXXXXXXXXXXXXXX",
    status: str = "WON",
    deadline_offset_hours: int = 24,
    as_dependent_id: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id="01HRGXXXXXXXXXXXXXXXXXXXXX",
        user_id=user_id,
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
        ticket_type_id="01HTTXXXXXXXXXXXXXXXXXXXXX",
        status=status,
        lottery_rank=1,
        waitlist_position=None,
        confirmation_deadline=datetime.now(UTC) + timedelta(hours=deadline_offset_hours),
        confirmed_at=None,
        forfeited_at=None,
        cancelled_at=None,
        as_dependent_id=as_dependent_id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _ticket(
    *,
    ticket_id: str = "01HTKXXXXXXXXXXXXXXXXXXXXX",
    status: str = "ISSUED",
    user_id: str = "01HUUXXXXXXXXXXXXXXXXXXXXX",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=ticket_id,
        registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
        user_id=user_id,
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
        status=status,
        issued_at=datetime.now(UTC),
        used_at=datetime.now(UTC) if status == "USED" else None,
        used_by_device="scanner-A-01" if status == "USED" else None,
        revoked_at=datetime.now(UTC) if status == "REVOKED" else None,
        revoke_reason="活動取消" if status == "REVOKED" else None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


# ─── confirm_registration_and_issue_ticket ───


@pytest.mark.asyncio
async def test_confirm_happy_path_creates_ticket(svc: TicketService) -> None:
    svc.registration_svc.lock_owned_for_confirmation = AsyncMock(return_value=_reg_detail())
    svc.registration_svc.mark_confirmed_in_session = AsyncMock(return_value=None)
    svc.repo.create_or_raise = AsyncMock(return_value=_ticket())

    result = await svc.confirm_registration_and_issue_ticket(
        registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        user_role="EMPLOYEE",
    )
    #:reg/ticket 1:1,直接回 TicketDetail
    assert result.status == "ISSUED"
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_confirm_others_registration_returns_notfound(svc: TicketService) -> None:
    """:ownership-aware lock 由 RegistrationService 直接擋越權,raise NotFound"""
    svc.registration_svc.lock_owned_for_confirmation = AsyncMock(
        side_effect=RegistrationNotFoundError("報名紀錄不存在")
    )
    with pytest.raises(RegistrationNotFoundError):
        await svc.confirm_registration_and_issue_ticket(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_confirm_only_won_status_allowed(svc: TicketService) -> None:
    svc.registration_svc.lock_owned_for_confirmation = AsyncMock(
        return_value=_reg_detail(status="REGISTERED")
    )
    with pytest.raises(CannotForfeitError):
        await svc.confirm_registration_and_issue_ticket(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_confirm_after_deadline_raises(svc: TicketService) -> None:
    svc.registration_svc.lock_owned_for_confirmation = AsyncMock(
        return_value=_reg_detail(deadline_offset_hours=-1)
    )
    with pytest.raises(ConfirmationExpiredError):
        await svc.confirm_registration_and_issue_ticket(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )


@pytest.mark.asyncio
async def test_confirm_double_raises_ticket_already_issued(svc: TicketService) -> None:
    """同 reg 第二次 confirm — repo 觸 UNIQUE,raise TicketAlreadyIssuedError(BR-05)"""
    svc.registration_svc.lock_owned_for_confirmation = AsyncMock(return_value=_reg_detail())
    svc.registration_svc.mark_confirmed_in_session = AsyncMock(return_value=None)
    svc.repo.create_or_raise = AsyncMock(side_effect=TicketAlreadyIssuedError("dup"))

    with pytest.raises(TicketAlreadyIssuedError):
        await svc.confirm_registration_and_issue_ticket(
            registration_id="01HRGXXXXXXXXXXXXXXXXXXXXX",
            user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
            user_role="EMPLOYEE",
        )
    # commit 不該被呼叫(交由 caller / dependency 結束時 rollback)
    svc.session.commit.assert_not_awaited()


# ─── verify_and_use_ticket ───


def _session_info(
    *,
    starts_offset_min: int = -10,
    ends_offset_min: int = 60,
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id="01HSSSXXXXXXXXXXXXXXXXXXXX",
        starts_at=now + timedelta(minutes=starts_offset_min),
        ends_at=now + timedelta(minutes=ends_offset_min),
    )


@pytest.mark.asyncio
async def test_verify_session_not_found_raises_invalid(svc: TicketService) -> None:
    """Fix #4:event_svc.get_session 回 None 時必須 raise TicketInvalidError,
    不可靜默繞過 BR-07 時段檢查"""
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="u",
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
    )
    svc.event_svc.get_session = AsyncMock(return_value=None)
    # 即使 atomic_verify 會成功也必須先 raise
    svc.repo.atomic_verify_and_use = AsyncMock()

    with pytest.raises(TicketInvalidError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")
    # 必須在進入 atomic UPDATE 之前就被擋下
    svc.repo.atomic_verify_and_use.assert_not_awaited()


@pytest.mark.asyncio
async def test_verify_happy_path_atomic_use(svc: TicketService) -> None:
    """有效 QR + 在 boundary 內 + ISSUED → 核銷成功"""
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="01HUUXXXXXXXXXXXXXXXXXXXXX",
        session_id="01HSSSXXXXXXXXXXXXXXXXXXXX",
    )
    used_at = datetime.now(UTC)
    #:atomic_verify_and_use 回 3-tuple (user_id, session_id, used_at)
    svc.repo.atomic_verify_and_use = AsyncMock(
        return_value=(
            "01HUUXXXXXXXXXXXXXXXXXXXXX",
            "01HSSSXXXXXXXXXXXXXXXXXXXX",
            used_at,
        )
    )
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())

    result = await svc.verify_and_use_ticket(
        qr_payload=token, device_id="scanner-A-01", verifier_id="01HVRXXXXXXXXXXXXXXXXXXXXX"
    )
    assert result.ticket_id == "01HTKXXXXXXXXXXXXXXXXXXXXX"
    svc.session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_verify_double_scan_raises_already_used(svc: TicketService) -> None:
    """第一次 ISSUED→USED 成功;第二次 atomic UPDATE 0 rows → 撈實際 status=USED"""
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX",
        user_id="u",
        session_id="s",
    )
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.repo.atomic_verify_and_use = AsyncMock(return_value=None) # 0 rows
    svc.repo.get_status_and_used_at = AsyncMock(return_value=("USED", datetime.now(UTC)))

    with pytest.raises(TicketAlreadyUsedError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")


@pytest.mark.asyncio
async def test_verify_revoked_ticket_raises(svc: TicketService) -> None:
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX", user_id="u", session_id="s"
    )
    svc.event_svc.get_session = AsyncMock(return_value=_session_info())
    svc.repo.atomic_verify_and_use = AsyncMock(return_value=None)
    svc.repo.get_status_and_used_at = AsyncMock(return_value=("REVOKED", None))

    with pytest.raises(TicketRevokedError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")


@pytest.mark.asyncio
async def test_verify_invalid_jwt_raises(svc: TicketService) -> None:
    with pytest.raises(TicketInvalidError):
        await svc.verify_and_use_ticket(
            qr_payload="not.a.valid.token",
            device_id="scanner-A-01",
            verifier_id="v",
        )


@pytest.mark.asyncio
async def test_verify_jwt_missing_tid_raises_invalid(svc: TicketService) -> None:
    """JWT payload 缺 tid → TicketInvalidError"""
    import jwt as _jwt # local import

    token = _jwt.encode(
        {"uid": "u", "sid": "s", "exp": int(datetime.now(UTC).timestamp()) + 60},
        svc.qr_signer._private_key_pem, # type: ignore[attr-defined]
        algorithm="EdDSA",
        headers={"kid": "test"},
    )
    with pytest.raises(TicketInvalidError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")


@pytest.mark.asyncio
async def test_verify_too_early_raises_event_not_started(svc: TicketService) -> None:
    """starts_at 還在 30 分鐘外 → EventNotStartedError;新流程 boundary 先擋,
    atomic UPDATE 不該被呼叫(省 DB write+WAL)。"""
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX", user_id="u", session_id="s"
    )
    # starts_at 在 60 分鐘後 → 超出 30 分鐘窗
    svc.event_svc.get_session = AsyncMock(return_value=_session_info(starts_offset_min=60))
    svc.repo.atomic_verify_and_use = AsyncMock(return_value=("u", "s", datetime.now(UTC)))

    with pytest.raises(EventNotStartedError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")
    # boundary 先擋,UPDATE 沒被呼叫 → 不需要 rollback
    svc.repo.atomic_verify_and_use.assert_not_awaited()


@pytest.mark.asyncio
async def test_verify_too_late_raises_event_ended(svc: TicketService) -> None:
    """ends_at 已過 30 分鐘以上 → EventEndedError;atomic UPDATE 不該被呼叫"""
    token, _ = svc.qr_signer.sign_ticket(
        ticket_id="01HTKXXXXXXXXXXXXXXXXXXXXX", user_id="u", session_id="s"
    )
    svc.event_svc.get_session = AsyncMock(
        return_value=_session_info(starts_offset_min=-90, ends_offset_min=-60)
    )
    svc.repo.atomic_verify_and_use = AsyncMock(return_value=("u", "s", datetime.now(UTC)))

    with pytest.raises(EventEndedError):
        await svc.verify_and_use_ticket(qr_payload=token, device_id="scanner-A-01", verifier_id="v")
    svc.repo.atomic_verify_and_use.assert_not_awaited()


# ─── revoke ───


@pytest.mark.asyncio
async def test_revoke_event_cancelled_bulk(svc: TicketService) -> None:
    svc.event_svc.get_event = AsyncMock(
        return_value=SimpleNamespace(
            title="家庭日",
            sessions=[SimpleNamespace(id="s1"), SimpleNamespace(id="s2")],
        )
    )
    # bulk_revoke 改回 (count, user_ids);user_ids 由 RETURNING 直接拿,
    # 不再 commit 後另行 list_by_session(避免歷史 REVOKED 票主誤入)
    svc.repo.bulk_revoke_by_session_ids = AsyncMock(return_value=(42, ["u1", "u2", "u3"]))

    count = await svc.revoke_tickets_by_event_cancelled("01HEVXXXXXXXXXXXXXXXXXXXXX", "活動取消")
    assert count == 42
    svc.repo.bulk_revoke_by_session_ids.assert_awaited_once_with(["s1", "s2"], "活動取消")


@pytest.mark.asyncio
async def test_revoke_event_not_found_returns_zero(svc: TicketService) -> None:
    """event 不存在 → 回 0,不該打 repo / 不該 commit"""
    svc.event_svc.get_event = AsyncMock(return_value=None)
    svc.repo.bulk_revoke_by_session_ids = AsyncMock(return_value=(0, []))

    count = await svc.revoke_tickets_by_event_cancelled("01HEVXXXXXXXXXXXXXXXXXXXXX", "活動取消")
    assert count == 0
    svc.repo.bulk_revoke_by_session_ids.assert_not_awaited()
    svc.session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoke_event_with_zero_sessions_returns_zero(svc: TicketService) -> None:
    """event 存在但 sessions=[] → 回 0,不該打 repo / 不該 commit"""
    svc.event_svc.get_event = AsyncMock(return_value=SimpleNamespace(title="家庭日", sessions=[]))
    svc.repo.bulk_revoke_by_session_ids = AsyncMock(return_value=(0, []))

    count = await svc.revoke_tickets_by_event_cancelled("01HEVXXXXXXXXXXXXXXXXXXXXX", "活動取消")
    assert count == 0
    svc.repo.bulk_revoke_by_session_ids.assert_not_awaited()
    svc.session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoke_with_admin_actor_writes_audit_with_actor_id(svc: TicketService) -> None:
    """ admin 主動取消活動,actor_id / actor_role 應透傳給 audit"""
    svc.event_svc.get_event = AsyncMock(
        return_value=SimpleNamespace(title="家庭日", sessions=[SimpleNamespace(id="s1")])
    )
    svc.repo.bulk_revoke_by_session_ids = AsyncMock(return_value=(3, ["u1", "u2", "u3"]))

    count = await svc.revoke_tickets_by_event_cancelled(
        "01HEVXXXXXXXXXXXXXXXXXXXXX",
        "管理員撤銷",
        actor_id="01HADXXXXXXXXXXXXXXXXXXXXX",
        actor_role="ADMIN",
    )
    assert count == 3
    svc.session.commit.assert_awaited()
