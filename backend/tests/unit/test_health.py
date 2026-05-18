""" sanity test — /health endpoint(下一輪 auth 完整 e2e)"""

from fastapi.testclient import TestClient


def test_health_endpoint() -> None:
    # 用 lazy import 避免測試環境沒設好 OTel / DB 時 import 就死
    from app.main import app

    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
