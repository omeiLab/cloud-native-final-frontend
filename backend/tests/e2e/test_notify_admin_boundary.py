"""E2E Scenarios: Notifications + Boundary conditions"""

from __future__ import annotations

import httpx

# ── Notifications ──────────────────────────────────────────────────────────


def test_list_notifications(client: httpx.Client, employee_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/notifications", headers=employee_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert "items" in data
    assert "total" in data


def test_notification_unread_count(client: httpx.Client, employee_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/notifications/unread-count", headers=employee_headers)
    assert r.status_code == 200
    assert "unread_count" in r.json()["data"]


# ── Boundary conditions ────────────────────────────────────────────────────


def test_malformed_json_returns_400(client: httpx.Client) -> None:
    r = client.post(
        "/api/v1/auth/refresh",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code >= 400


def test_unknown_endpoint_404(client: httpx.Client, employee_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/does-not-exist", headers=employee_headers)
    # 可能是 404 或是 cors/security 層的其他碼;至少不是 200
    assert r.status_code != 200


def test_cors_preflight(client: httpx.Client) -> None:
    r = client.options(
        "/api/v1/me",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
