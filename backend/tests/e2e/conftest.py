"""E2E test fixtures — 對 https://cets.alanh.uk 打真實 API。

使用永久 dev token 機制(commit 15d692d):三個固定 ULID 的 user token
不查 Redis denylist,logout 後仍有效。

JWT 簽章金鑰透過環境變數注入,**不可寫死於檔案內**(若硬編碼且 commit
即等同 production secret 公開)。執行前先設環境變數:

  export CETS_JWT_SIGNING_KEY="$(kubectl -n cets get secret cets-jwt-signing-key \\
    -o jsonpath='{.data.signing-key}' | base64 -d)"

⚠️ production stable 後務必:
  1. 刪除 security.py 中的 PERMANENT_DEV_USER_IDS
  2. DELETE 三個 dev user
  3. rotate cets-jwt-signing-key Secret
"""

from __future__ import annotations

import hashlib
import os
import time
from typing import Any

import httpx
import jwt
import pytest

# ── 固定 dev user IDs(對齊 app/core/security.py) ──────────────────────────
DEV_ADMIN_ID = "01E2EADMINTSMCROLEXXXXXXXX"
DEV_EMPLOYEE_ID = "01E2EEMPLOYEETSMCROLEXXXXX"
DEV_VERIFIER_ID = "01E2EVERIFIERTSMCROLEXXXXX"

JWT_SIGNING_KEY = os.environ.get("CETS_JWT_SIGNING_KEY") or pytest.exit(
    "CETS_JWT_SIGNING_KEY 環境變數未設;請從 K8s Secret cets-jwt-signing-key 注入,"
    "不可在檔案中硬編碼(會 commit 即洩漏 production secret)"
)
JWT_KID = os.environ.get("CETS_JWT_KID", "v1")
JWT_ALGORITHM = os.environ.get("CETS_JWT_ALGORITHM", "HS256")
ISSUER = os.environ.get("CETS_ISSUER", "https://cets.alanh.uk")
BASE_URL = os.environ.get("CETS_BASE_URL", "https://cets.alanh.uk")


def _make_token(sub: str, ttl_seconds: int = 3600) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "jti": hashlib.sha256(f"{sub}:{time.monotonic_ns()}".encode()).hexdigest()[:32],
        "iat": now,
        "exp": now + ttl_seconds,
        "iss": ISSUER,
    }
    return jwt.encode(payload, JWT_SIGNING_KEY, algorithm=JWT_ALGORITHM, headers={"kid": JWT_KID})


# ── Token fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def admin_token() -> str:
    return _make_token(DEV_ADMIN_ID, ttl_seconds=3600)


@pytest.fixture(scope="session")
def employee_token() -> str:
    return _make_token(DEV_EMPLOYEE_ID, ttl_seconds=3600)


@pytest.fixture(scope="session")
def verifier_token() -> str:
    return _make_token(DEV_VERIFIER_ID, ttl_seconds=3600)


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def employee_headers(employee_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {employee_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def verifier_headers(verifier_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {verifier_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(base_url=BASE_URL, verify=True, timeout=15.0) as c:
        yield c


# ── Helpers ─────────────────────────────────────────────────────────────────


def create_published_event(
    client: httpx.Client,
    admin_headers: dict[str, str],
    title: str,
    site: str = "HSINCHU",
) -> tuple[str, str, str]:
    """建立活動 → 加場次 → 加票種 → 發布。回傳 (event_id, session_id, ticket_type_id)"""
    # 1. 建立活動
    r = client.post(
        "/api/v1/admin/events",
        json={"title": title, "description": "E2E test", "allowed_sites": [site]},
        headers=admin_headers,
    )
    assert r.status_code == 201, f"Create event failed: {r.text}"
    event_id = r.json()["data"]["id"]

    # 2. 加場次
    r2 = client.post(
        f"/api/v1/admin/events/{event_id}/sessions",
        json={
            "title": f"{title} Session",
            "venue": "E2E Room",
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
    assert r2.status_code == 201, f"Create session failed: {r2.text}"
    session_id = r2.json()["data"]["id"]

    # 3. 加票種
    r3 = client.post(
        f"/api/v1/admin/sessions/{session_id}/ticket-types",
        json={"name": "一般票", "quota": 2},
        headers=admin_headers,
    )
    assert r3.status_code == 201, f"Create ticket type failed: {r3.text}"
    ticket_type_id = r3.json()["data"]["id"]

    # 4. 發布
    r4 = client.post(
        f"/api/v1/admin/events/{event_id}/publish",
        headers=admin_headers,
    )
    assert r4.status_code == 200, f"Publish failed: {r4.text}"

    return event_id, session_id, ticket_type_id
