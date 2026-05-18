from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")

    # CNPG 讀寫分離
    database_url_rw: str = Field(default="postgresql+asyncpg://app:app@localhost:5432/cets")
    database_url_ro: str = Field(default="postgresql+asyncpg://app:app@localhost:5432/cets")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0")

    # JWT
    jwt_signing_key: str = Field(default="dev-jwt-key-CHANGE-ME")
    jwt_kid: str = Field(default="v1")
    jwt_algorithm: str = Field(default="HS256")
    access_token_ttl_seconds: int = Field(default=3600)
    refresh_token_ttl_seconds: int = Field(default=28800)
    # /auth/refresh 暴力 / 重放保護
    # per-IP 30/min:正常 client 每小時 1 次刷,30/min 已是 60 倍預期峰值;
    # 攻擊者拿到失竊 refresh token 在同 IP 嘗試暴力枚舉時即觸發。
    auth_refresh_rate_per_minute_per_ip: int = Field(default=30)

    # Ticket QR EdDSA 簽章(設計 06 §10.6)— 私鑰 PEM 存 K8s Secret cets-ticket-signing-key
    # 公鑰預載於驗票裝置可離線驗簽;dev 預設 key 不要進 prod
    ticket_signing_private_key: str = Field(default="")
    ticket_signing_public_key: str = Field(default="")
    ticket_signing_kid: str = Field(default="v1")
    ticket_qr_ttl_seconds: int = Field(default=60)
    # 驗票端點 rate limit 與 device 白名單()
    ticket_verify_rate_per_minute: int = Field(default=60)
    # device 白名單:逗號分隔的 device_id list;空字串表示 lab 模式不啟用,
    # production 必須設為實際 scanner ID 列(或改為 K8s registry / mTLS)。
    ticket_verify_device_allowlist: str = Field(default="")

    # OIDC
    oidc_provider: str = Field(default="auth0")
    auth0_domain: str = Field(default="")
    auth0_issuer: str = Field(default="")
    auth0_client_id: str = Field(default="")
    auth0_client_secret: str = Field(default="")
    auth0_callback_url: str = Field(default="https://cets.alanh.uk/auth/callback")
    # follow-up:前端在不同環境(localhost dev / staging / prod)
    # 時 callback URL 不同。白名單(逗號分隔)允許前端在 GET /oidc/authorize-url 帶
    # ?redirect_uri=<...> 指定本次想用哪一個,後端驗證在此清單內後才簽 authorize_url
    # 並在 token exchange 用同一個。沒帶時 fallback auth0_callback_url(預設值)。
    # production:列實際的前端 callback URL(可多個 staging / prod);prod 不該含 localhost。
    auth0_allowed_callback_urls: str = Field(
        default="https://cets.alanh.uk/auth/callback,http://localhost:5173/auth/callback"
    )
    #:獨立守衛 flag(不綁 is_production,因為 lab cluster 也標 production
    # 但需要 localhost 給前端 dev)。**真 production** 部署時 values-prod overlay 設
    # true,啟動拒任何含 localhost / 私網 IP 的 callback URL。
    auth0_callback_guard_strict: bool = Field(default=False)
    #:CORS 跨 origin 白名單(逗號分隔)。production 同 domain 不需要,
    # 但前端 npm run dev 在 localhost:5173 + API 在 cets.alanh.uk 是跨 origin,
    # 瀏覽器 preflight OPTIONS 要 Access-Control-Allow-Origin 對齊白名單才放行。
    # production 上線時 values-prod overlay 移除 localhost(同 callback 守衛邏輯)。
    cors_allowed_origins: str = Field(default="https://cets.alanh.uk,http://localhost:5173")

    mock_oidc_issuer: str = Field(default="http://mock-oidc.cets-system.svc.cluster.local")
    mock_oidc_client_id: str = Field(default="cets")
    mock_oidc_client_secret: str = Field(default="cets-dev-secret")

    # WebSocket Pub/Sub HMAC(:防 Redis publisher 冒名)
    ws_pubsub_hmac_key: str = Field(default="")
    # WebSocket 認證流程(post-handshake auth message,而非 query string token)
    ws_auth_timeout_seconds: int = Field(default=10)
    # 單一 user 同時連線上限(防 OOM;設計 §Backlog 沒列具體數,實作上限 5 分頁)
    ws_max_connections_per_user: int = Field(default=5)
    # /ws 每 IP 開連線速率(per minute)
    ws_open_rate_per_minute_per_ip: int = Field(default=20)

    # SMTP(notification email channel)— lab 用 Mailpit,prod 走企業 relay
    smtp_host: str = Field(default="mailpit.cets-system.svc.cluster.local")
    smtp_port: int = Field(default=1025)
    smtp_username: str = Field(default="")
    smtp_password: str = Field(default="")
    smtp_start_tls: bool = Field(default=False) # Mailpit 不啟 TLS
    smtp_from_address: str = Field(default="noreply@cets.alanh.uk")
    smtp_timeout_seconds: int = Field(default=10)
    # production 走真實 relay 時設 True,啟動時若 start_tls/auth 缺即 fail-fast
    # ()。lab 用 Mailpit 不啟用,維持 False。
    smtp_require_tls_and_auth: bool = Field(default=False)

    # OTel
    otlp_endpoint: str = Field(default="")
    grafana_cloud_basic_auth_header: str = Field(default="")
    service_name: str = Field(default="cets-main-api")

    # Service
    service_url: str = Field(default="https://cets.alanh.uk")

    # 把 OpenAPI JSON 在 production 也對外開放(讓 frontend 走 codegen 拿 schema)。
    # /api/openapi.json 永遠 read-only,不含 PII;Swagger UI(/api/docs)是否開
    # 由 expose_swagger_ui 控制(預設 false,以免暴露無謂攻擊面)
    expose_openapi_json: bool = Field(default=True)
    expose_swagger_ui: bool = Field(default=False)

    # Batch B(A3):archive S3 / MinIO 接入(設計 04 §8.2)
    # endpoint 空字串 → archive job 走 dry-run(只 log 候選,不上傳),lab 期間預設關。
    # production / staging:走 cets namespace cets-minio-archive-key Secret 注入 AK/SK。
    archive_s3_endpoint_url: str = Field(default="")
    archive_s3_access_key_id: str = Field(default="")
    archive_s3_secret_access_key: str = Field(default="")
    archive_s3_bucket: str = Field(default="cets-archive")
    archive_s3_region: str = Field(default="us-east-1")
    # 候選條件:sessions.ends_at < NOW() - INTERVAL 'archive_retention_days days'
    archive_retention_days: int = Field(default=730) # 2 年

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
