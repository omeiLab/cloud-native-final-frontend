"""E2E Scenario 5: Ticket 票券確認 + 驗票授權"""

from __future__ import annotations

import httpx

from tests.e2e.conftest import create_published_event


def test_confirm_without_won_status(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """未中籤 confirm 應被拒(409/422/403)"""
    _, session_id, ticket_type_id = create_published_event(
        client, admin_headers, "E2E Confirm Fail"
    )

    r1 = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r1.status_code == 201
    reg_id = r1.json()["data"]["id"]

    r2 = client.post(
        f"/api/v1/registrations/{reg_id}/confirm",
        json={"confirmed": True},
        headers=employee_headers,
    )
    assert r2.status_code in (409, 422, 403), (
        f"Expected 409/422/403, got {r2.status_code}: {r2.text}"
    )
    assert r2.json()["success"] is False


def test_my_tickets_list(client: httpx.Client, employee_headers: dict[str, str]) -> None:
    """可列出自己的票券"""
    r = client.get("/api/v1/me/tickets", headers=employee_headers)
    assert r.status_code == 200
    assert "items" in r.json()["data"]


def test_verify_empty_qr_400(client: httpx.Client, verifier_headers: dict[str, str]) -> None:
    """空 QR → 400"""
    r = client.post(
        "/api/v1/verify",
        json={"qr_data": ""},
        headers=verifier_headers,
    )
    assert r.status_code >= 400
    assert r.json()["success"] is False


def test_verify_invalid_qr_400(client: httpx.Client, verifier_headers: dict[str, str]) -> None:
    """無效 QR → 400"""
    r = client.post(
        "/api/v1/verify",
        json={"qr_data": "invalid"},
        headers=verifier_headers,
    )
    assert r.status_code >= 400
    assert r.json()["success"] is False


def test_verify_requires_verifier_role(
    client: httpx.Client, employee_headers: dict[str, str]
) -> None:
    """Employee 不可驗票 → 403"""
    r = client.post(
        "/api/v1/verify",
        json={"qr_data": "test"},
        headers=employee_headers,
    )
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    assert r.json()["success"] is False
