"""Opt-in OTLP/HTTP tracing for the research service."""

import logging
import os

from fastapi import FastAPI
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExportResult
from opentelemetry.trace import Status
from starlette.routing import Match


class _SafeExportDiagnostics(logging.Filter):
    def filter(self, record):
        # requests errors and collector reason phrases may include credentials.
        record.msg = "OTLP trace export diagnostic (details redacted)"
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True


_export_diagnostics = _SafeExportDiagnostics()
_logger = logging.getLogger(__name__)


class SafeOTLPSpanExporter(OTLPSpanExporter):
    """Allow only route templates and status metadata across the export boundary."""

    def __init__(self, app: FastAPI):
        logging.getLogger(
            "opentelemetry.exporter.otlp.proto.http.trace_exporter"
        ).addFilter(_export_diagnostics)
        super().__init__(timeout=3)
        self._app = app

    def export(self, spans):
        routes = {getattr(route, "path", None) for route in self._app.routes}
        safe_spans = []
        for span in spans:
            original = span.attributes or {}
            route = original.get("http.route")
            route = route if isinstance(route, str) and route in routes else "/{unmatched}"
            method = original.get("http.request.method", original.get("http.method", "HTTP"))
            if method not in {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE"}:
                method = "HTTP"
            attributes = {
                "http.route": route,
                "http.method": method,
                "http.url": route,
                "url.full": route,
                "http.target": route,
            }
            for key in ("http.status_code", "http.response.status_code"):
                if isinstance(original.get(key), int):
                    attributes[key] = original[key]
            # Framework exception events and status descriptions contain arbitrary
            # application messages and stack frames. Keep error state, omit text.
            safe_spans.append(ReadableSpan(
                name=f"{method} {route}",
                context=span.context,
                parent=span.parent,
                resource=span.resource,
                attributes=attributes,
                kind=span.kind,
                status=Status(span.status.status_code),
                start_time=span.start_time,
                end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope,
            ))
        try:
            return super().export(safe_spans)
        except Exception:
            # Do not let BatchSpanProcessor log a raw exception/traceback.
            _logger.error("OTLP trace export failed (details redacted)")
            return SpanExportResult.FAILURE


def _safe_request_hook(app):
    def hook(span, scope):
        if span and span.is_recording():
            path = "/{unmatched}"
            for route in app.routes:
                match, _ = route.matches(scope)
                if match == Match.FULL:
                    path = getattr(route, "path", "/{unmatched}")
                    break
            for key in ("http.url", "url.full", "http.target", "http.route"):
                span.set_attribute(key, path)
            span.set_attribute("url.query", "")
    return hook


def configure_telemetry(app: FastAPI) -> TracerProvider | None:
    """Use standard OTEL env configuration; no endpoint means no exporter/thread."""
    if os.getenv("OTEL_SDK_DISABLED", "false").lower() == "true":
        return None
    if not (
        os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
        or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    ):
        return None

    # Resource.create merges OTEL_RESOURCE_ATTRIBUTES and OTEL_SERVICE_NAME.
    provider = TracerProvider(resource=Resource.create({
        "service.name": os.getenv("OTEL_SERVICE_NAME") or "ooda-research-backend",
        "service.version": "0.1.0",
    }))
    provider.add_span_processor(BatchSpanProcessor(SafeOTLPSpanExporter(app)))
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        server_request_hook=_safe_request_hook(app),
        # Nonempty impossible matches override header-capture environment defaults.
        http_capture_headers_server_request=["(?!)"],
        http_capture_headers_server_response=["(?!)"],
        http_capture_headers_sanitize_fields=[".*"],
        exclude_spans=["receive", "send"],
    )
    return provider
