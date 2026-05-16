"""CORS middleware — 加。

驗:
- preflight OPTIONS 對 whitelist origin 回 200 + 對應 Access-Control-Allow-* headers
- preflight OPTIONS 對非 whitelist origin 無 ACAO header(瀏覽器即拒)
- 簡單 GET 帶 Origin: 白名單 應有 ACAO header
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.middleware import register_middleware


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # 固定白名單避免 default value 漂移影響測試
    from app.config import settings

    monkeypatch.setattr(
        settings,
        "cors_allowed_origins",
        "https://cets.alanh.uk,http://localhost:5173",
    )
    app = FastAPI()
    register_middleware(app)

    @app.get("/api/ping")
    def ping() -> dict[str, str]:
        return {"ok": "1"}

    return TestClient(app)


def test_preflight_options_from_whitelist_origin_allowed(client: TestClient) -> None:
    r = client.options(
        "/api/ping",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert r.headers.get("access-control-allow-credentials") == "true"
    assert "GET" in r.headers.get("access-control-allow-methods", "")
    allow_headers = r.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" in allow_headers
    assert "content-type" in allow_headers


def test_preflight_from_evil_origin_no_acao_header(client: TestClient) -> None:
    r = client.options(
        "/api/ping",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    # starlette CORSMiddleware 對非白名單 origin 不會回 ACAO header → 瀏覽器擋
    assert r.headers.get("access-control-allow-origin") is None


def test_simple_get_from_whitelist_has_acao(client: TestClient) -> None:
    r = client.get("/api/ping", headers={"Origin": "https://cets.alanh.uk"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "https://cets.alanh.uk"
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_simple_get_from_evil_origin_no_acao(client: TestClient) -> None:
    r = client.get("/api/ping", headers={"Origin": "https://evil.example.com"})
    # endpoint 仍 200(server 端不擋,Origin 驗證是 browser 端責任),
    # 但缺 ACAO header → 瀏覽器丟掉 response
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") is None
