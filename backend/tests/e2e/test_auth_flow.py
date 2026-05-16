"""E2E Scenario 1: Auth 鏈路 — token verify / me / oidc / refresh / health

API 回應格式:直接回 data 或 error(無 {success:true/false, data:{}} wrapper)
"""

from __future__ import annotations

import httpx


def test_me_admin(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/auth/me", headers=admin_headers)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    data = r.json()
    assert data["employee_id"] == "E2EADM01"
    assert data["role"] == "ADMIN"
    assert data["site"] == "HSINCHU"


def test_me_employee(client: httpx.Client, employee_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/auth/me", headers=employee_headers)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    data = r.json()
    assert data["employee_id"] == "E2EEMP01"
    assert data["role"] == "EMPLOYEE"


def test_me_verifier(client: httpx.Client, verifier_headers: dict[str, str]) -> None:
    r = client.get("/api/v1/auth/me", headers=verifier_headers)
    assert r.status_code == 200
    assert r.json()["role"] == "VERIFIER"


def test_me_without_token_401(client: httpx.Client) -> None:
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_me_bad_token_401(client: httpx.Client) -> None:
    r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid"})
    assert r.status_code == 401


def test_health_no_auth(client: httpx.Client) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_readyz_no_auth(client: httpx.Client) -> None:
    r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"


def test_oidc_authorize_url(client: httpx.Client) -> None:
    r = client.get("/api/v1/auth/oidc/authorize-url")
    assert r.status_code == 200
    data = r.json()
    assert "authorize_url" in data
    assert "state" in data
    assert len(data["state"]) > 0


def test_refresh_bad_token_401(client: httpx.Client) -> None:
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": "invalid"})
    assert r.status_code == 401


def test_logout_no_refresh_returns_400(
    client: httpx.Client, employee_headers: dict[str, str]
) -> None:
    r = client.post("/api/v1/auth/logout", json={}, headers=employee_headers)
    assert r.status_code >= 400
