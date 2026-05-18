from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.core.db import close_db_engines, init_db_engines
from app.core.events import event_bus
from app.core.exceptions import register_exception_handlers
from app.core.lifecycle import bind_signal_handlers, register_lifecycle
from app.core.logging import configure_logging, get_logger
from app.core.metrics import register_metrics
from app.core.middleware import register_middleware
from app.core.otel import setup_otel
from app.core.qr_signer import get_qr_signer
from app.core.redis import close_redis, init_redis
from app.core.scheduler import init_scheduler, shutdown_scheduler
from app.modules.admin.jobs import register_admin_jobs
from app.modules.notification.event_handlers import register_notification_handlers
from app.modules.notification.jobs import register_notification_jobs
from app.modules.notification.ws_manager import get_connection_manager
from app.modules.notification.ws_pubsub import get_pubsub_subscriber
from app.modules.registration.jobs import register_registration_jobs

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging(settings.log_level)
    logger.info("starting", environment=settings.environment, service=settings.service_name)
    bind_signal_handlers()
    #:啟動 fail-fast 自檢,擋部署疏忽下用 dev-marker / 空值
    # 直接跑 production。
    if settings.is_production:
        dev_markers = ("dev-", "change-me", "CHANGE-ME", "PLACEHOLDER")
        if any(settings.jwt_signing_key.startswith(m) for m in dev_markers):
            raise RuntimeError("JWT_SIGNING_KEY 仍是 dev-marker(預設值或佔位符)— production 拒啟動")
        if not settings.ticket_signing_private_key:
            raise RuntimeError("TICKET_SIGNING_PRIVATE_KEY 未設 — production 不允許 QR 簽章未配置")
        allowlist = settings.ticket_verify_device_allowlist.strip()
        if not allowlist:
            raise RuntimeError(
                "TICKET_VERIFY_DEVICE_ALLOWLIST 為空 — production 必須設 device 白名單"
            )
        # audit:擋運維用 placeholder 字串過了空字串檢查就上線
        # ("PROD-SCANNER-PLACEHOLDER-REPLACE-ME" 等非空 placeholder 仍會讓所有
        # 真實 scanner 被 verify 端點 403)
        placeholder_markers = (
            "PLACEHOLDER",
            "REPLACE-ME",
            "REPLACE_ME",
            "CHANGE-ME",
            "CHANGE_ME",
            "TODO",
        )
        if any(m in allowlist.upper() for m in placeholder_markers):
            raise RuntimeError(
                "TICKET_VERIFY_DEVICE_ALLOWLIST 仍含 placeholder(REPLACE-ME / CHANGE-ME 等)— "
                "請填實際 scanner ID 列表"
            )
    #:OIDC callback URL 白名單在「真 production」不可含 localhost / 私網 IP —
    # 防 phishing+本機 listener 拿 code(open redirect 變種)。lab cluster 標
    # ENVIRONMENT=production 但需 localhost 給前端 dev,故另用獨立 flag
    # auth0_callback_guard_strict(values-prod overlay 設 true 才啟用),不綁 is_production。
    if settings.auth0_callback_guard_strict:
        callback_unsafe_markers = (
            "LOCALHOST",
            "127.0.0.1",
            "0.0.0.0", # noqa: S104 — 字串比對用,非實際 bind
            "10.",
            "192.168.",
            "::1",
        )
        for url in settings.auth0_allowed_callback_urls.split(","):
            u = url.strip().upper()
            if not u:
                continue
            if any(m in u for m in callback_unsafe_markers):
                raise RuntimeError(
                    f"AUTH0_ALLOWED_CALLBACK_URLS 含非 production-safe 值 ({url.strip()}) — "
                    "auth0_callback_guard_strict=true 下不允許 localhost / 私網 IP"
                )
        # CORS_ALLOWED_ORIGINS 共用同一組 unsafe markers — production 不該對外開
        # localhost 跨 origin(同樣是 phishing+本機 listener 攻擊面;CORS 雖比
        # OAuth code 弱但仍可放大 XSS / CSRF 影響)
        for origin in settings.cors_allowed_origins.split(","):
            u = origin.strip().upper()
            if not u:
                continue
            if any(m in u for m in callback_unsafe_markers):
                raise RuntimeError(
                    f"CORS_ALLOWED_ORIGINS 含非 production-safe 值 ({origin.strip()}) — "
                    "auth0_callback_guard_strict=true 下不允許 localhost / 私網 IP"
                )
    #:由 smtp_require_tls_and_auth 控制(production 走真實
    # relay 時應設 True,啟動拒不安全配置;lab 用 Mailpit 維持 False)
    if settings.smtp_require_tls_and_auth and (
        not settings.smtp_start_tls or not settings.smtp_username or not settings.smtp_password
    ):
        raise RuntimeError(
            "SMTP_REQUIRE_TLS_AND_AUTH=true 但 start_tls/username/password 三者未齊備;"
            "請設 SMTP_START_TLS=true 並提供 relay 帳密"
        )
    await init_db_engines(settings.database_url_rw, settings.database_url_ro)
    await init_redis(settings.redis_url)
    # warm-up QR signer 避免首次 verify_and_use_ticket 走 cold path 讀 K8s Secret;
    # 同時驗證簽章金鑰能正確 derive 公鑰,啟動失敗總比首次驗票才爆好
    if settings.ticket_signing_private_key:
        get_qr_signer()
        logger.info("qr_signer_warmed_up")
    scheduler = init_scheduler()
    register_registration_jobs(scheduler)
    register_notification_jobs(scheduler)
    register_admin_jobs(scheduler)
    # WebSocket:訂閱 Redis pattern user:* 後轉發到本副本連線(設計 §Backlog)
    ws_manager = get_connection_manager()
    ws_subscriber = get_pubsub_subscriber(ws_manager)
    ws_subscriber.start()
    logger.info("ws_pubsub_started")
    # R6:notification handler 訂閱跨模組事件(in-process event bus)
    register_notification_handlers(event_bus)
    yield
    logger.info("shutting down")
    # graceful shutdown(對齊 §Backlog):先送 close frame 給所有 WS 連線
    closed = await ws_manager.close_all(code=1001, reason="Server shutting down")
    logger.info("ws_close_all", closed=closed)
    await ws_subscriber.stop()
    shutdown_scheduler()
    await close_redis()
    await close_db_engines()


def create_app() -> FastAPI:
    # OpenAPI JSON 預設 production 仍開放(frontend codegen 用,內容 read-only schema);
    # Swagger UI 預設 production 關閉(避免無謂互動入口暴露攻擊面)。
    docs_enabled = settings.expose_swagger_ui or not settings.is_production
    openapi_enabled = settings.expose_openapi_json or not settings.is_production
    app = FastAPI(
        title="CETS — Corporate Event Ticketing System",
        version="0.1.0",
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if openapi_enabled else None,
        lifespan=lifespan,
    )

    setup_otel(app, service_name=settings.service_name, endpoint=settings.otlp_endpoint)
    register_middleware(app)
    register_exception_handlers(app)
    register_metrics(app)
    register_lifecycle(app)

    # Include module routers (+ 各模組陸續加進來)
    from app.modules.auth.api import me_router as auth_me_router
    from app.modules.auth.api import router as auth_router
    from app.modules.event.api import admin_router as event_admin_router
    from app.modules.event.api import employee_router as event_employee_router
    from app.modules.registration.api import me_router as registration_me_router
    from app.modules.registration.api import router as registration_router
    from app.modules.ticket.api import (
        confirm_router as ticket_confirm_router,
    )
    from app.modules.ticket.api import (
        me_router as ticket_me_router,
    )
    from app.modules.ticket.api import (
        verify_router as ticket_verify_router,
    )

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(auth_me_router, prefix="/api/v1/me", tags=["me"])
    app.include_router(event_employee_router, prefix="/api/v1/events", tags=["events"])
    app.include_router(event_admin_router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(registration_router, prefix="/api/v1/registrations", tags=["registration"])
    app.include_router(registration_me_router, prefix="/api/v1/me", tags=["me"])
    app.include_router(ticket_confirm_router, prefix="/api/v1/registrations", tags=["ticket"])
    app.include_router(ticket_me_router, prefix="/api/v1/me", tags=["me"])
    app.include_router(ticket_verify_router, prefix="/api/v1/verify", tags=["verify"])

    from app.modules.admin.api import router as admin_router
    from app.modules.notification.api import router as notification_router
    from app.modules.notification.ws_endpoint import ws_router

    #:對齊設計 05 §12 改用 /api/v1/notifications
    app.include_router(notification_router, prefix="/api/v1/notifications", tags=["notification"])
    # admin endpoints 在 /api/v1/admin/*(設計 05 §13)
    # 注意:event.admin_router 已在 /api/v1/admin/events 註冊 CRUD,本 router 不衝突
    # (paths 為 /sites/* / /events/{id}/dashboard / /events/{id}/registrations / export)
    app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(ws_router, tags=["websocket"])

    @app.get("/health", tags=["health"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"], summary="Readiness probe (DB + Redis)")
    async def readyz() -> dict[str, str]:
        from app.core.db import check_db_connectivity
        from app.core.redis import check_redis_connectivity

        await check_db_connectivity()
        await check_redis_connectivity()
        return {"status": "ready"}

    return app


app = create_app()
