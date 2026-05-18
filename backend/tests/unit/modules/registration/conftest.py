"""registration 模組共用 fixture"""

from unittest.mock import AsyncMock

import pytest

from app.modules.registration import service as registration_service_mod
from app.modules.registration.service import RegistrationService


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> RegistrationService:
    """建一個 mocked RegistrationService:repo / event_svc / session 都是 AsyncMock。

    audit 也 patch 成 noop,免每個 test 重複設。
    """

    async def _noop_audit(*a: object, **k: object) -> None:
        return None

    monkeypatch.setattr(registration_service_mod, "audit", _noop_audit)

    s = RegistrationService.__new__(RegistrationService)
    s.session = AsyncMock()
    s.event_svc = AsyncMock()
    s.repo = AsyncMock()
    return s
