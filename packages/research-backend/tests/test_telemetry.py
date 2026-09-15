"""Exercise real FastAPI requests and decode bytes sent to an OTLP receiver."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest


@pytest.fixture
def create_app(monkeypatch):
    # main constructs its ASGI entrypoint on import. Supply only the import-time
    # settings here, then restore the environment before exercising each app.
    with monkeypatch.context() as import_env:
        import_env.setenv("DATABASE_URL", "postgresql://unused")
        import_env.setenv("OTEL_SDK_DISABLED", "true")
        from research_backend.main import create_app as factory
    return factory


@pytest.mark.parametrize("signal_endpoint", [False, True])
def test_requests_publish_correlated_spans_without_credentials(
    monkeypatch, signal_endpoint, create_app
):
    payloads = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            payloads.append((self.path, self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    thread = threading.Thread(target=receiver.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{receiver.server_port}")
    if signal_endpoint:
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            f"http://127.0.0.1:{receiver.server_port}/custom/traces",
        )
    monkeypatch.setenv("OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST", ".*")
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=test")
    # Exercise the real lifespan; database DDL is unrelated to HTTP telemetry.
    monkeypatch.setattr("research_backend.main.init_db", lambda _engine: None)
    monkeypatch.setenv("DIVE_SCHEDULER_ENABLED", "false")
    app = create_app({"DATABASE_URL": "sqlite://", "RESEARCH_SERVICE_TOKEN": "secret"})
    @app.get("/test-failure/{record_id}")
    async def failure(record_id: str):
        raise RuntimeError("exception-private-marker")

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            headers = {"traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"}
            assert client.get("/health?token=query-secret", headers=headers).status_code == 200
            assert client.get("/api/health", headers=headers).status_code == 401
            assert client.get(
                "/api/health", headers={**headers, "Authorization": "Bearer secret"}
            ).status_code == 200
            auth_headers = {**headers, "Authorization": "Bearer secret"}
            assert client.get("/private-path-marker", headers=auth_headers).status_code == 404
            assert client.get(
                "/test-failure/private-id-marker", headers=auth_headers
            ).status_code == 500
        # Lifespan shutdown must deliver queued spans without an explicit test flush.
        assert payloads
        expected_path = "/custom/traces" if signal_endpoint else "/v1/traces"
        assert all(path == expected_path for path, _ in payloads)
        spans = []
        for _, payload in payloads:
            assert b"query-secret" not in payload
            assert b"Bearer secret" not in payload
            assert b"private-path-marker" not in payload
            assert b"private-id-marker" not in payload
            assert b"exception-private-marker" not in payload
            request = ExportTraceServiceRequest.FromString(payload)
            for resource_spans in request.resource_spans:
                attrs = {a.key: a.value.string_value for a in resource_spans.resource.attributes}
                assert attrs["service.name"] == "ooda-research-backend"
                assert attrs["deployment.environment.name"] == "test"
                spans.extend(s for scope in resource_spans.scope_spans for s in scope.spans)
        servers = [s for s in spans if s.kind == 2]
        assert len(servers) == 5
        assert {s.name for s in servers} == {
            "GET /health", "GET /api/health", "GET /{unmatched}",
            "GET /test-failure/{record_id}",
        }
        failed = next(s for s in servers if s.name == "GET /test-failure/{record_id}")
        assert failed.status.code == 2  # Preserve ERROR without exception text.
        assert failed.status.message == ""
        assert not failed.events
        assert all(s.trace_id.hex() == "1234567890abcdef1234567890abcdef" for s in servers)
        assert all(s.parent_span_id.hex() == "1234567890abcdef" for s in servers)
        statuses = [
            a.value.int_value for s in servers for a in s.attributes
            if a.key in ("http.status_code", "http.response.status_code")
        ]
        assert sorted(statuses) == [200, 200, 401, 404, 500]
    finally:
        if getattr(app.state, "telemetry_provider", None):
            app.state.telemetry_provider.shutdown()
        receiver.shutdown()
        receiver.server_close()
        thread.join()


@pytest.mark.parametrize("disabled", [False, True])
def test_telemetry_is_opt_in_and_can_be_disabled(monkeypatch, disabled, create_app):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    if disabled:
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1")
        monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    app = create_app({"DATABASE_URL": "postgresql://unused"})
    assert app.state.telemetry_provider is None
    assert TestClient(app).get("/health").status_code == 200


def test_export_failure_diagnostics_do_not_expose_collector_credentials(
    monkeypatch, caplog, create_app
):
    monkeypatch.setenv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        "http://127.0.0.1:1/v1/traces?token=synthetic-secret-marker",
    )
    app = create_app({"DATABASE_URL": "postgresql://unused"})
    try:
        assert TestClient(app).get("/health").status_code == 200
        app.state.telemetry_provider.force_flush(timeout_millis=5000)
        assert caplog.records
        assert "synthetic-secret-marker" not in caplog.text
        assert "127.0.0.1" not in caplog.text
    finally:
        app.state.telemetry_provider.shutdown()
