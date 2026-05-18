"""E2E Scenario 3: Registration 報名完整流程"""

from __future__ import annotations

import httpx

from tests.e2e.conftest import create_published_event


def test_register_for_session(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """Employee 可報名(需 session_id + ticket_type_id)"""
    _, session_id, ticket_type_id = create_published_event(client, admin_headers, "E2E Register")

    r = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r.status_code == 201, f"Register failed: {r.text}"
    data = r.json()["data"]
    assert data["session_id"] == session_id
    assert data["status"] == "REGISTERED"


def test_duplicate_registration(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """重複報名 → 409"""
    _, session_id, ticket_type_id = create_published_event(client, admin_headers, "E2E Dup Reg")

    r1 = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r1.status_code == 201

    r2 = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r2.status_code == 409, f"Expected 409, got {r2.status_code}: {r2.text}"
    assert r2.json()["error"]["code"] == "ALREADY_REGISTERED"


def test_ineligible_site_registration(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """不同廠區無法報名 → 403"""
    _, session_id, ticket_type_id = create_published_event(
        client, admin_headers, "E2E TAINAN Event", site="TAINAN"
    )
    # employee site=HSINCHU, 活動 TAINAN
    r = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    assert r.json()["error"]["code"] == "INELIGIBLE"


def test_list_my_registrations(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """列出自己報名"""
    _, session_id, ticket_type_id = create_published_event(client, admin_headers, "E2E MyReg")

    client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )

    r = client.get("/api/v1/me/registrations", headers=employee_headers)
    assert r.status_code == 200
    items = r.json()["data"]["items"]
    found = any(item["session_id"] == session_id for item in items)
    assert found, f"Registration for {session_id} not found"


def test_cancel_registration(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """取消報名 → CANCELLED"""
    _, session_id, ticket_type_id = create_published_event(client, admin_headers, "E2E Cancel")

    r1 = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r1.status_code == 201
    reg_id = r1.json()["data"]["id"]

    r2 = client.delete(f"/api/v1/registrations/{reg_id}", headers=employee_headers)
    assert r2.status_code == 200, f"Cancel failed: {r2.text}"
    assert r2.json()["data"]["status"] == "CANCELLED"

    # 重新報名應成功
    r3 = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r3.status_code == 201


def test_unknown_session_registration(
    client: httpx.Client, employee_headers: dict[str, str]
) -> None:
    """報名不存在的場次 → 404"""
    r = client.post(
        "/api/v1/registrations",
        json={
            "session_id": "01NONEXISTENTSESSIONID00000",
            "ticket_type_id": "01NONEXISTENTTICKETID00000",
        },
        headers=employee_headers,
    )
    assert r.status_code == 404
    assert r.json()["success"] is False
