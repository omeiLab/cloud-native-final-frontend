"""lottery 模組共用 fixture(抽出)"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.lottery import service as lottery_service_mod
from app.modules.lottery.service import LotteryService


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> LotteryService:
    """mocked LotteryService:repo / event_svc / registration_svc / session 全 AsyncMock。

    audit() patch 成 noop 免每 test 重設。
    session.begin_nested() 設為 async context manager mock(
     後 lottery 用 SAVEPOINT 包 apply + mark_completed)。
    """

    async def _noop_audit(*a: object, **k: object) -> None:
        return None

    monkeypatch.setattr(lottery_service_mod, "audit", _noop_audit)

    s = LotteryService.__new__(LotteryService)
    s.session = AsyncMock()
    sp_cm = MagicMock()
    sp_cm.__aenter__ = AsyncMock(return_value=None)
    sp_cm.__aexit__ = AsyncMock(return_value=None)
    s.session.begin_nested = MagicMock(return_value=sp_cm)
    s.event_svc = AsyncMock()
    s.registration_svc = AsyncMock()
    s.repo = AsyncMock()
    return s
