"""admin 模組 API — 對齊設計 05 §13:儀表板 / 報名清單 / 匯出 / 廠區人數預覽。

ADMIN role gate(`require_role(Role.ADMIN)`)套在 router 層,所有 endpoint 共用。
 後:`mask_pii=false` 路徑強制寫 audit(BR-09 PII 讀取追蹤)+
export 走 size guard(防同步上限超量造成 OOM / 集中外洩)。
"""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import get_ro_session, get_rw_session
from app.core.middleware import get_client_meta
from app.core.object_storage import stream_archive_object
from app.core.redis import get_redis
from app.modules.admin.errors import ExportTaskNotFoundError, ExportTaskNotReadyError
from app.modules.admin.export_state import (
    ExportFormat,
    enqueue,
    get_state,
    parse_created_at,
)
from app.modules.admin.exporter import (
    export_csv,
    export_xlsx,
    sanitize_for_export,
)
from app.modules.admin.service import AdminService
from app.modules.auth.dependencies import (
    CurrentUser,
    build_auth_service,
    require_admin_full,
    require_admin_read,
)
from app.modules.event.schemas import CancelEventRequest
from app.modules.event.service import EventService
from app.modules.lottery.service import LotteryService
from app.modules.registration.service import RegistrationService
from app.modules.ticket.service import TicketService
from app.shared.admin_ref import (
    DashboardData,
    ExportTaskCreated,
    ExportTaskStatus,
    RegistrationWithUser,
    SiteEmployeeCount,
)
from app.shared.event_ref import EventDetail
from app.shared.lottery_ref import LotteryResult
from app.shared.pagination import PagedResult

# Router 層 require_admin_read(ADMIN 或 ADMIN_VIEWER 都通過);
# 個別需要全權限的 endpoint 加 require_admin_full 二段驗證(RBAC 細分)
router = APIRouter(dependencies=[Depends(require_admin_read())])

_ULID_PATH = Path(min_length=26, max_length=26, pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _build_admin_service(session: AsyncSession) -> AdminService:
    """共用 wire helper(:消除 RW/RO factory 重覆;
    :不再為 admin 建 qr_signer 依賴 — 只用 stats path)"""
    event_svc = EventService(session)
    reg_svc = RegistrationService(session, event_svc)
    ticket_svc = TicketService(session, event_svc, reg_svc) # qr_signer=None
    auth_svc = build_auth_service(session)
    lottery_svc = LotteryService(session, event_svc, reg_svc)
    return AdminService(
        event_svc=event_svc,
        registration_svc=reg_svc,
        ticket_svc=ticket_svc,
        auth_svc=auth_svc,
        lottery_svc=lottery_svc,
    )


async def get_rw_admin_service() -> AsyncIterator[AdminService]:
    async for session in get_rw_session():
        yield _build_admin_service(session)


async def get_ro_admin_service() -> AsyncIterator[AdminService]:
    async for session in get_ro_session():
        yield _build_admin_service(session)


RWAdminServiceDep = Annotated[AdminService, Depends(get_rw_admin_service)]
ROAdminServiceDep = Annotated[AdminService, Depends(get_ro_admin_service)]


async def _audit_pii_unmask(
    *,
    actor: CurrentUser,
    request: Request,
    action: str,
    entity_id: str,
    extra: dict[str, str | int | None] | None = None,
) -> None:
    """:mask_pii=false 路徑寫 BR-09 audit。
    開獨立 RW session(read endpoint 走 RO 主邏輯;audit 寫入需 RW)。
    """
    request_id, ip, ua = get_client_meta(request)
    after = {
        "actor_role": str(actor.role),
        "endpoint": action,
        "entity_id": entity_id,
        **(extra or {}),
    }
    async for session in get_rw_session():
        await audit(
            session,
            actor_id=actor.id,
            actor_role=str(actor.role),
            action="admin.pii_unmask_read",
            entity_type="event",
            entity_id=entity_id,
            after=after,
            request_id=request_id,
            ip_address=ip,
            user_agent=ua,
        )
        await session.commit()
        break


@router.post(
    "/events/{event_id}/cancel",
    dependencies=[Depends(require_admin_full())],
    response_model=EventDetail,
    summary="取消活動 + 觸發票券撤銷與通知(全修:整鏈路接線)",
)
async def cancel_event(
    event_id: Annotated[str, _ULID_PATH],
    body: CancelEventRequest,
    user: CurrentUser,
    request: Request,
    svc: RWAdminServiceDep,
) -> EventDetail:
    """活動取消整鏈路:
    1. 標 status=CANCELLED + audit
    2. bulk 撤銷該活動所有 ISSUED 票券 + audit
    3. publish EventCancelled → notification 發 EVENT_CANCELLED 給所有受影響員工
    """
    request_id = getattr(request.state, "request_id", None)
    return await svc.cancel_event(
        event_id=event_id,
        actor_id=user.id,
        actor_role=str(user.role),
        reason=body.reason,
        request_id=request_id,
    )


@router.post(
    "/sessions/{session_id}/run-lottery",
    dependencies=[Depends(require_admin_full())],
    response_model=LotteryResult,
    summary="管理員手動觸發抽籤(冪等;同 lottery_runner CronJob 邏輯)",
)
async def run_lottery_manual(
    session_id: Annotated[str, _ULID_PATH],
    user: CurrentUser,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_rw_session)],
) -> LotteryResult:
    """手動執行抽籤(設計 06 §9):
    - 平日由 `lottery-runner` CronJob 每分鐘掃 `lottery_at <= NOW()` 的 session
    - 此 endpoint 提供管理員「一鍵抽籤」用於 debug / lottery_runner 異常時補救
    - 冪等:同 session+ticket_type 已抽過 → 走 idempotent fallback,回現有結果
    - 場次需先進 REGISTRATION_CLOSED 或更後狀態,否則 reg 無 IN_LOTTERY 候選
    """
    request_id, _ip, _ua = get_client_meta(request)
    event_svc = EventService(db)
    reg_svc = RegistrationService(db, event_svc)
    lottery_svc = LotteryService(db, event_svc, reg_svc)
    result = await lottery_svc.execute_lottery(session_id)
    await audit(
        db,
        actor_id=user.id,
        actor_role=str(user.role),
        action="lottery.run_manual",
        entity_type="session",
        entity_id=session_id,
        after={
            "ticket_types": [
                {
                    "ticket_type_id": tt.ticket_type_id,
                    "winner_count": tt.record.winner_count,
                    "waitlist_count": tt.record.waitlist_count,
                    "newly_executed": tt.newly_executed,
                }
                for tt in result.ticket_types
            ],
        },
        request_id=request_id,
    )
    await db.commit()
    return result


@router.get(
    "/sites/employee-count",
    response_model=SiteEmployeeCount,
    summary="廠區員工數預覽(設計 05 §13.5)",
)
async def get_site_employee_count(
    svc: ROAdminServiceDep,
    sites: Annotated[
        str,
        Query(description="逗號分隔廠區代碼,如 HSINCHU,TAINAN", max_length=200),
    ],
) -> SiteEmployeeCount:
    site_list = [s.strip() for s in sites.split(",") if s.strip()]
    return await svc.get_site_employee_count(site_list)


@router.get(
    "/events/{event_id}/registrations",
    response_model=PagedResult[RegistrationWithUser],
    summary="活動報名清單(分頁 + PII mask)",
)
async def list_event_registrations(
    event_id: Annotated[str, _ULID_PATH],
    svc: ROAdminServiceDep,
    user: CurrentUser,
    request: Request,
    session_id: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query(max_length=30, pattern=r"^[A-Z_]+$")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    mask_pii: Annotated[bool, Query()] = True,
) -> PagedResult[RegistrationWithUser]:
    if not mask_pii:
        # RBAC:取明文需 ADMIN_FULL(VIEWER 不夠)
        from app.shared.enums import Role

        if user.role != Role.ADMIN:
            from app.core.exceptions import ForbiddenError

            raise ForbiddenError("拉明文 PII 需 ADMIN 角色(ADMIN_VIEWER 不夠)")
        #:拉明文 → 寫 BR-09 audit log
        await _audit_pii_unmask(
            actor=user,
            request=request,
            action="list_event_registrations",
            entity_id=event_id,
            extra={"page": page, "page_size": page_size},
        )
    return await svc.list_event_registrations(
        event_id,
        session_id=session_id,
        status=status,
        page=page,
        page_size=page_size,
        mask_pii=mask_pii,
    )


@router.get(
    "/events/{event_id}/dashboard",
    response_model=DashboardData,
    summary="活動儀表板統計聚合(設計 05 §13.7)",
)
async def get_event_dashboard(
    event_id: Annotated[str, _ULID_PATH],
    svc: ROAdminServiceDep,
) -> DashboardData:
    return await svc.get_event_dashboard(event_id)


@router.get(
    "/events/{event_id}/export",
    dependencies=[Depends(require_admin_full())], #:export 限 ADMIN(VIEWER 拒)
    summary="匯出活動報名報表(csv / xlsx)— 限 ADMIN 全權限",
)
async def export_event_registrations(
    event_id: Annotated[str, _ULID_PATH],
    svc: ROAdminServiceDep,
    user: CurrentUser,
    request: Request,
    format: Annotated[str, Query(pattern="^(csv|xlsx)$")] = "csv",
    mask_pii: Annotated[bool, Query()] = True,
) -> Response:
    """同步生成 — 設計 06 §12.6 < 5000 筆走此路徑;> 5000 拋 ExportTooLargeError"""
    #:size guard(避免靜默截斷 + OOM + 集中 PII 外洩)
    await svc.assert_export_size(event_id)
    if not mask_pii:
        await _audit_pii_unmask(
            actor=user,
            request=request,
            action="export_event_registrations",
            entity_id=event_id,
            extra={"format": format},
        )
    paged = await svc.list_event_registrations(
        event_id, page=1, page_size=svc.EXPORT_SYNC_LIMIT, mask_pii=mask_pii
    )
    items = sanitize_for_export(paged.items)

    if format == "csv":
        body = export_csv(items)
        return Response(
            content=body,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="registrations_{event_id}.csv"',
            },
        )
    body = export_xlsx(items)
    return Response(
        content=body,
        media_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        headers={
            "Content-Disposition": f'attachment; filename="registrations_{event_id}.xlsx"',
        },
    )


# Batch B(A6):export 背景化 — POST 入隊 + GET 查狀態 + GET 下載


@router.post(
    "/events/{event_id}/export/async",
    dependencies=[Depends(require_admin_full())],
    response_model=ExportTaskCreated,
    summary="背景匯出活動報名(> 5000 筆走此路徑)— 限 ADMIN 全權限",
)
async def enqueue_async_export(
    event_id: Annotated[str, _ULID_PATH],
    user: CurrentUser,
    request: Request,
    format: Annotated[ExportFormat, Query(pattern="^(csv|xlsx)$")] = "csv",
    mask_pii: Annotated[bool, Query()] = True,
) -> ExportTaskCreated:
    """入隊一個 export 任務,worker 每 30s drain 一個。

    回 task_id + poll_url。前端輪詢 poll_url 等到 status=SUCCEEDED 後改打 download_url。
    """
    redis = get_redis()
    if not mask_pii:
        await _audit_pii_unmask(
            actor=user,
            request=request,
            action="export_event_registrations_async",
            entity_id=event_id,
            extra={"format": format},
        )
    task_id = await enqueue(
        redis,
        event_id=event_id,
        fmt=format,
        mask_pii=mask_pii,
        actor_id=user.id,
    )
    poll_url = f"/api/v1/admin/events/{event_id}/export/tasks/{task_id}"
    return ExportTaskCreated(task_id=task_id, status="PENDING", poll_url=poll_url)


@router.get(
    "/events/{event_id}/export/tasks/{task_id}",
    response_model=ExportTaskStatus,
    summary="查 export 背景任務狀態(輪詢 PENDING/RUNNING/SUCCEEDED/FAILED)",
)
async def get_export_task_status(
    event_id: Annotated[str, _ULID_PATH],
    task_id: Annotated[str, _ULID_PATH],
) -> ExportTaskStatus:
    redis = get_redis()
    state = await get_state(redis, task_id)
    if state is None or state.get("event_id") != event_id:
        raise ExportTaskNotFoundError("export task 不存在或已過期")
    status = state.get("status", "UNKNOWN")
    download_url: str | None = (
        f"/api/v1/admin/events/{event_id}/export/tasks/{task_id}/download"
        if status == "SUCCEEDED"
        else None
    )

    def _parse(field: str) -> datetime | None:
        raw = state.get(field)
        if raw is None:
            return None
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return None

    return ExportTaskStatus(
        task_id=task_id,
        event_id=state["event_id"],
        format=state.get("format", "csv"),
        status=status,
        created_at=parse_created_at(state),
        started_at=_parse("started_at"),
        finished_at=_parse("finished_at"),
        error=state.get("error"),
        download_url=download_url,
    )


@router.get(
    "/events/{event_id}/export/tasks/{task_id}/download",
    dependencies=[Depends(require_admin_full())],
    summary="下載 export 檔(代理 MinIO,SUCCEEDED 才有效)— 限 ADMIN 全權限",
)
async def download_export(
    event_id: Annotated[str, _ULID_PATH],
    task_id: Annotated[str, _ULID_PATH],
    user: CurrentUser,
    request: Request,
) -> StreamingResponse:
    redis = get_redis()
    state = await get_state(redis, task_id)
    if state is None or state.get("event_id") != event_id:
        raise ExportTaskNotFoundError("export task 不存在或已過期")
    if state.get("status") != "SUCCEEDED":
        raise ExportTaskNotReadyError(f"export task 狀態為 {state.get('status')},尚不可下載")
    object_key = state.get("object_key")
    if not object_key:
        raise ExportTaskNotReadyError("export task 缺 object_key")

    # download 等同拉明文 PII(若 mask_pii=false 入隊)— 寫 audit
    if state.get("mask_pii") == "0":
        await _audit_pii_unmask(
            actor=user,
            request=request,
            action="download_async_export",
            entity_id=event_id,
            extra={"task_id": task_id, "format": state.get("format")},
        )

    fmt = state.get("format", "csv")
    media_type = (
        "text/csv; charset=utf-8"
        if fmt == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    headers = {
        "Content-Disposition": (f'attachment; filename="export_{event_id}_{task_id}.{fmt}"'),
    }
    return StreamingResponse(
        stream_archive_object(object_key), media_type=media_type, headers=headers
    )


__all__ = ["router"]
