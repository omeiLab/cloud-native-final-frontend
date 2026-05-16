"""E2E Scenario 4: 抽籤鏈路(需 lottery-runner 正常運作)"""

from __future__ import annotations

import httpx

from tests.e2e.conftest import create_published_event


def test_create_event_with_multiple_ticket_types(
    client: httpx.Client, admin_headers: dict[str, str]
) -> None:
    """活動可含多種票種"""
    r = client.post(
        "/api/v1/admin/events",
        json={
            "title": "E2E Multi TT",
            "description": "Multi ticket types",
            "allowed_sites": ["HSINCHU"],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201
    event_id = r.json()["data"]["id"]

    r2 = client.post(
        f"/api/v1/admin/events/{event_id}/sessions",
        json={
            "title": "Multi TT Session",
            "venue": "Room",
            "starts_at": "T09:00:00+08:00",
            "ends_at": "T17:00:00+08:00",
            "registration_opens_at": "T00:00:00+08:00",
            "registration_closes_at": "T23:59:59+08:00",
            "lottery_at": "T10:00:00+08:00",
            "waitlist_close_at": "T23:59:59+08:00",
            "confirmation_deadline_hours": 24,
        },
        headers=admin_headers,
    )
    assert r2.status_code == 201
    session_id = r2.json()["data"]["id"]

    # 加 2 票種
    for name in ("A 票", "B 票"):
        r3 = client.post(
            f"/api/v1/admin/sessions/{session_id}/ticket-types",
            json={"name": name, "quota": 2},
            headers=admin_headers,
        )
        assert r3.status_code == 201

    # Publish
    r4 = client.post(
        f"/api/v1/admin/events/{event_id}/publish",
        headers=admin_headers,
    )
    assert r4.status_code == 200


def test_registration_before_lottery_shows_registered(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """報名後未抽籤,status=REGISTERED"""
    _, session_id, ticket_type_id = create_published_event(
        client, admin_headers, "E2E Before Lottery"
    )

    r = client.post(
        "/api/v1/registrations",
        json={"session_id": session_id, "ticket_type_id": ticket_type_id},
        headers=employee_headers,
    )
    assert r.status_code == 201
    reg_id = r.json()["data"]["id"]
    assert r.json()["data"]["status"] == "REGISTERED"

    # 再查一次確認
    r2 = client.get("/api/v1/me/registrations", headers=employee_headers)
    assert r2.status_code == 200
    items = r2.json()["data"]["items"]
    reg = next(i for i in items if i["id"] == reg_id)
    assert reg["status"] == "REGISTERED"


def test_dashboard_accessible_for_event(
    client: httpx.Client, admin_headers: dict[str, str]
) -> None:
    """Admin 可看活動儀表板"""
    event_id, _, _ = create_published_event(client, admin_headers, "E2E Dashboard Test")

    r = client.get(
        f"/api/v1/admin/events/{event_id}/dashboard",
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["success"] is True


def test_registration_list_admin(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    """Admin 可查活動報名列表"""
    event_id, _, _ = create_published_event(client, admin_headers, "E2E Reg List")

    r = client.get(
        f"/api/v1/admin/events/{event_id}/registrations",
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert "items" in r.json()["data"]
