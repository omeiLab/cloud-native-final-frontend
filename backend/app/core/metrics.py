"""Prometheus metrics — /metrics 端點 + 應用層自訂 counters / histograms"""

from fastapi import FastAPI
from prometheus_client import Counter, Gauge, Histogram
from prometheus_fastapi_instrumentator import Instrumentator


def register_metrics(app: FastAPI) -> None:
    """掛 /metrics 端點 + 對應 OpenAPI 排除"""
    Instrumentator(
        excluded_handlers=["/metrics", "/health", "/readyz"],
        should_round_latency_decimals=True,
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


# 應用層自訂指標(對齊 §6.4 + §Backlog)
WEBSOCKET_CONNECTIONS = Counter(
    "cets_websocket_connections_total",
    "WebSocket 連線生命週期事件累計(opened / closed / rejected)",
    ["status"],
)

#:當前活躍連線(對齊 §Backlog gauge 規格;Counter 推算誤差大)
WEBSOCKET_ACTIVE_CONNECTIONS = Gauge(
    "cets_websocket_active_connections",
    "本副本當前活躍 WebSocket 連線數(註冊+認證後)",
)

WEBSOCKET_MESSAGES_SENT = Counter(
    "cets_websocket_messages_sent_total",
    "WebSocket 推播訊息總數",
    ["type"],
)

WEBSOCKET_MESSAGES_DROPPED = Counter(
    "cets_websocket_messages_dropped_total",
    "因無連線被丟棄的 WebSocket 訊息",
)

PUBSUB_LAG_SECONDS = Histogram(
    "cets_websocket_pubsub_lag_seconds",
    "Redis Pub/Sub PUBLISH 至推送的延遲",
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10),
)

LOTTERY_DURATION_SECONDS = Histogram(
    "cets_lottery_duration_seconds",
    "lottery 單票種執行時間;以 quota_bucket(<10 / 10-100 / >100)分組防高基數",
    ["quota_bucket"],
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60),
)

NOTIFICATION_SEND_FAILURES = Counter(
    "cets_notification_send_failures_total",
    "通知發送失敗",
    ["channel"],
)

# registration 排程任務指標(對齊設計 06 §8.7 + 序列圖 §8)
SCHEDULER_JOB_RUNS = Counter(
    "cets_scheduler_job_runs_total",
    "排程任務執行次數(以 outcome 區分)",
    ["job", "outcome"], # outcome: success / skipped / error
)

SCHEDULER_JOB_DURATION = Histogram(
    "cets_scheduler_job_duration_seconds",
    "排程任務執行時間(僅取得 advisory lock 後計時)",
    ["job"],
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30),
)

REGISTRATION_EXPIRED_TOTAL = Counter(
    "cets_registration_expired_total",
    "WON → EXPIRED 的 registration 累計筆數(由 expire_overdue_won 處理)",
)

REGISTRATION_WAITLIST_PROMOTED = Counter(
    "cets_registration_waitlist_promoted_total",
    "WAITLISTED → WON 的遞補累計筆數",
    ["trigger"], # forfeit / expire
)

# ticket 模組指標(對齊設計 06 §10 + R4 ops)
TICKET_ISSUED_TOTAL = Counter(
    "cets_ticket_issued_total",
    "中籤確認後成功發票券的累計筆數",
)

TICKET_VERIFIED_TOTAL = Counter(
    "cets_ticket_verified_total",
    "驗票核銷請求結果分布",
    # outcome: success / already_used / revoked / out_of_window / invalid_jwt / not_found
    ["outcome"],
)

TICKET_REVOKED_TOTAL = Counter(
    "cets_ticket_revoked_total",
    "票券撤銷累計筆數",
    ["reason_kind"], # event_cancelled / admin_manual
)
