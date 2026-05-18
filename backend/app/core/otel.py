"""OpenTelemetry SDK 設定 — OTLP HTTP push 到 Grafana Cloud"""

import os

from fastapi import FastAPI

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def setup_otel(app: FastAPI, service_name: str, endpoint: str) -> None:
    """初始化 traces + 自動 instrument(若 OTLP endpoint 有設)。"""
    if not endpoint:
        logger.info("otel_disabled", reason="OTLP_ENDPOINT not set")
        _instrument_libs(app)
        return

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    headers: dict[str, str] = {}
    if settings.grafana_cloud_basic_auth_header:
        headers["Authorization"] = settings.grafana_cloud_basic_auth_header

    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": "0.1.0",
            "deployment.environment.name": settings.environment,
        }
    )
    tracer_provider = TracerProvider(resource=resource)
    span_exporter = OTLPSpanExporter(
        endpoint=endpoint.rstrip("/") + "/v1/traces",
        headers=headers,
    )
    tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
    trace.set_tracer_provider(tracer_provider)

    _instrument_libs(app)
    logger.info("otel_initialized", endpoint=endpoint, service=service_name)


def _instrument_libs(app: FastAPI) -> None:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app, excluded_urls="/health,/readyz,/metrics")
    except Exception: # pragma: no cover
        logger.exception("fastapi_instrumentation_failed")

    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
    except Exception: # pragma: no cover
        logger.exception("httpx_instrumentation_failed")

    # SQLAlchemy / Redis instrumentation 在 db.py / redis.py 初始化後再掛
    os.environ.setdefault("OTEL_PYTHON_LOG_CORRELATION", "true")
