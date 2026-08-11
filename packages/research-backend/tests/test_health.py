from fastapi.testclient import TestClient

from research_backend.main import app, create_app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "research-backend"


def test_research_api_requires_configured_service_bearer_token():
    protected_app = create_app(
        {
            "DATABASE_URL": "postgresql://unused",
            "RESEARCH_SERVICE_TOKEN": "service-secret",
        }
    )
    protected_client = TestClient(protected_app)

    assert protected_client.get("/health").status_code == 200

    missing = protected_client.get("/api/health")
    assert missing.status_code == 401
    assert missing.headers["www-authenticate"] == "Bearer"
    assert protected_client.get("/openapi.json").status_code == 401

    wrong = protected_client.get("/api/health", headers={"Authorization": "Bearer wrong-secret"})
    assert wrong.status_code == 401

    accepted = protected_client.get(
        "/api/health", headers={"Authorization": "Bearer service-secret"}
    )
    assert accepted.status_code == 200


def test_research_api_fails_closed_when_service_token_is_unconfigured():
    unconfigured_app = create_app({"DATABASE_URL": "postgresql://unused"})
    unconfigured_client = TestClient(unconfigured_app)

    response = unconfigured_client.get("/api/health")

    assert response.status_code == 503
