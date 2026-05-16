"""E2E Scenario 2: Event 建立 / 查詢 / 發布 / 廠區資格

API 回應格式:直接回 data(無 {success,data} wrapper)
"""

from __future__ import annotations

import httpx

from tests.e2e.conftest import create_published_event


def test_create_event_draft(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    r = client.post(
        "/api/v1/admin/events",
        json={
            "title": "E2E Draft Event",
            "description": "Draft test",
            "allowed_sites": ["HSINCHU"],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, f"Create failed: {r.text}"
    data = r.json()
    assert data["title"] == "E2E Draft Event"
    assert data["status"] == "DRAFT"
    assert data["allowed_sites"] == ["HSINCHU"]


def test_add_session(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    r = client.post(
        "/api/v1/admin/events",
        json={
            "title": "E2E Session Event",
            "description": "Session test",
            "allowed_sites": ["HSINCHU"],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, f"Create event failed: {r.text}"
    event_id = r.json()["id"]

    r2 = client.post(
        f"/api/v1/admin/events/{event_id}/sessions",
        json={
            "title": "Test Session",
            "venue": "Room A",
            "starts_at": "T09:00:00+08:00",
            "ends_at": "T17:00:00+08:00",
            "registration_opens_at": "T00:00:00+08:00",
            "registration_closes_at": "T23:59:59+08:00",
            "lottery_at": "T23:59:59+08:00",
            "waitlist_close_at": "T23:59:59+08:00",
            "confirmation_deadline_hours": 24,
        },
        headers=admin_headers,
    )
    assert r2.status_code == 201, f"Add session failed: {r2.text}"
    session = r2.json()
    assert session["title"] == "Test Session"
    assert session["status"] == "DRAFT"


def test_add_ticket_type(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    r = client.post(
        "/api/v1/admin/events",
        json={
            "title": "E2E TicketType Event",
            "description": "Ticket type test",
            "allowed_sites": ["HSINCHU"],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201
    event_id = r.json()["id"]

    r2 = client.post(
        f"/api/v1/admin/events/{event_id}/sessions",
        json={
            "title": "TT Session",
            "venue": "Room B",
            "starts_at": "T09:00:00+08:00",
            "ends_at": "T17:00:00+08:00",
            "registration_opens_at": "T00:00:00+08:00",
            "registration_closes_at": "T23:59:59+08:00",
            "lottery_at": "T23:59:59+08:00",
            "waitlist_close_at": "T23:59:59+08:00",
            "confirmation_deadline_hours": 24,
        },
        headers=admin_headers,
    )
    assert r2.status_code == 201
    session_id = r2.json()["id"]

    r3 = client.post(
        f"/api/v1/admin/sessions/{session_id}/ticket-types",
        json={"name": "VIP 票", "quota": 5},
        headers=admin_headers,
    )
    assert r3.status_code == 201, f"Add ticket type failed: {r3.text}"
    tt = r3.json()
    assert tt["name"] == "VIP 票"
    assert tt["quota"] == 5


def test_publish_event(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    event_id = _create_event_with_session(client, admin_headers, "E2E Publish")
    r = client.post(
        f"/api/v1/admin/events/{event_id}/publish",
        headers=admin_headers,
    )
    assert r.status_code == 200, f"Publish failed: {r.text}"
    assert r.json()["status"] == "PUBLISHED"


def test_published_event_visible_to_employee(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    create_published_event(client, admin_headers, "E2E Visible")

    r = client.get("/api/v1/events", headers=employee_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    titles = {e["title"] for e in items}
    assert "E2E Visible" in titles


def test_different_site_event_not_listed(
    client: httpx.Client,
    admin_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    create_published_event(client, admin_headers, "E2E TAINAN Only", site="TAINAN")

    r = client.get("/api/v1/events", headers=employee_headers)
    assert r.status_code == 200
    titles = {e["title"] for e in r.json()["items"]}
    assert "E2E TAINAN Only" not in titles


def test_admin_list_events_all_scope(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    """Admin 可透過 ?scope=all 看所有活動"""
    r = client.get("/api/v1/events?scope=all", headers=admin_headers)
    assert r.status_code == 200
    assert "items" in r.json()


def test_get_event_detail(client: httpx.Client, admin_headers: dict[str, str]) -> None:
    event_id, _, _ = create_published_event(client, admin_headers, "E2E Detail")

    r = client.get(f"/api/v1/events/{event_id}", headers=admin_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == event_id
    assert data["title"] == "E2E Detail"
    assert len(data["sessions"]) >= 1
    assert len(data["sessions"][0]["ticket_types"]) >= 1


def _create_event_with_session(
    client: httpx.Client, admin_headers: dict[str, str], title: str
) -> str:
    r = client.post(
        "/api/v1/admin/events",
        json={"title": title, "description": "test", "allowed_sites": ["HSINCHU"]},
        headers=admin_headers,
    )
    assert r.status_code == 201
    event_id = r.json()["id"]
    r2 = client.post(
        f"/api/v1/admin/events/{event_id}/sessions",
        json={
            "title": f"{title} Session",
            "venue": "Room",
            "starts_at": "T09:00:00+08:00",
            "ends_at": "T17:00:00+08:00",
            "registration_opens_at": "T00:00:00+08:00",
            "registration_closes_at": "T23:59:59+08:00",
            "lottery_at": "T23:59:59+08:00",
            "waitlist_close_at": "T23:59:59+08:00",
            "confirmation_deadline_hours": 24,
        },
        headers=admin_headers,
    )
    assert r2.status_code == 201
    return event_id
