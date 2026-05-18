"""UserRepository batch methods + AuthService Protocol 補完()"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.service import AuthService


@pytest.fixture
def auth_svc(monkeypatch: pytest.MonkeyPatch) -> AuthService:
    s = AuthService.__new__(AuthService)
    s.session = AsyncMock()
    s.user_repo = AsyncMock()
    s.refresh_repo = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_get_users_batch_empty_returns_empty(auth_svc: AuthService) -> None:
    """空 user_ids → 不打 repo,直接回 []"""
    auth_svc.user_repo.get_many_by_ids = AsyncMock(return_value=[])
    result = await auth_svc.get_users_batch([])
    assert result == []


@pytest.mark.asyncio
async def test_get_users_batch_returns_details(auth_svc: AuthService) -> None:
    fake_users = [
        SimpleNamespace(
            id="u1",
            employee_id="E1",
            name="Alice",
            email="a@example.com",
            department="R&D",
            site="HSINCHU",
            role="EMPLOYEE",
            status="ACTIVE",
        )
    ]
    auth_svc.user_repo.get_many_by_ids = AsyncMock(return_value=fake_users)
    result = await auth_svc.get_users_batch(["u1"])
    assert len(result) == 1
    assert result[0].employee_id == "E1"


@pytest.mark.asyncio
async def test_count_active_employees_by_sites_zero_for_unmatched(auth_svc: AuthService) -> None:
    """site 沒員工 → 不漏 0(repo 已保證 dict.fromkeys 0 預設)"""
    auth_svc.user_repo.count_active_employees_by_sites = AsyncMock(
        return_value={"HSINCHU": 100, "OVERSEAS": 0}
    )
    result = await auth_svc.count_active_employees_by_sites(["HSINCHU", "OVERSEAS"])
    assert result == {"HSINCHU": 100, "OVERSEAS": 0}


@pytest.mark.asyncio
async def test_count_active_employees_by_sites_empty_input(auth_svc: AuthService) -> None:
    auth_svc.user_repo.count_active_employees_by_sites = AsyncMock(return_value={})
    result = await auth_svc.count_active_employees_by_sites([])
    assert result == {}
