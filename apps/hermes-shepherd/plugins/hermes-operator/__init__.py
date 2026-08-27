"""Native Hermes commands for Bob's operator plane."""

import hashlib
import json
import logging
import os
import fcntl
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


_gateway_command_context: ContextVar[dict[str, str]] = ContextVar(
    "hermes_operator_gateway_command_context",
    default={},
)


def capture_gateway_context(*, event, **_kwargs) -> None:
    """Bridge transport IDs that Hermes exposes before slash-command dispatch."""
    source = event.source
    platform = getattr(source.platform, "value", source.platform)
    message_id = getattr(source, "message_id", None) or getattr(event, "message_id", None)
    _gateway_command_context.set({
        "HERMES_SESSION_PLATFORM": str(platform or ""),
        "HERMES_SESSION_CHAT_ID": str(getattr(source, "chat_id", "") or ""),
        "HERMES_SESSION_MESSAGE_ID": str(message_id or ""),
    })


def _session_env() -> dict[str, str]:
    from gateway.session_context import get_session_env

    names = (
        "HERMES_SESSION_PLATFORM",
        "HERMES_SESSION_CHAT_ID",
        "HERMES_SESSION_MESSAGE_ID",
    )
    gateway_values = _gateway_command_context.get()
    return {
        name: get_session_env(name, "") or gateway_values.get(name, "")
        for name in names
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


_USAGE_POLICY = {
    "today": ("bob", "R0"),
    "capture": ("ooda", "R1"),
    "research": ("ooda", "R1"),
    "work": ("bob", "R2"),
    "approve": ("bob", "R3"),
    "status": ("bob", "R0"),
    "fleet": ("skillfleet", "R0"),
    "close": ("ooda", "R0"),
    "stop": ("bob", "R3"),
}
_log = logging.getLogger("hermes_operator.usage")


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _duration_bucket(seconds: float) -> str:
    if seconds < 1:
        return "<1s"
    if seconds < 10:
        return "1-10s"
    if seconds < 60:
        return "10-60s"
    if seconds < 300:
        return "1-5m"
    return ">5m"


def build_usage_record(*, request_id: str, intent: str, channel: str, outcome: str,
                       duration_seconds: float, evidence: str, observed_at: str) -> dict:
    """Privacy-safe hermes_usage journal record: digests and categories only."""
    owner, risk_class = _USAGE_POLICY[intent]
    identity = "\0".join(("hermes-usage", request_id, intent, outcome, observed_at))
    return {
        "schemaVersion": 1,
        "recordId": _sha256(identity),
        "source": "bob",
        "observedAt": observed_at,
        "sessionIdDigest": None,
        "projectIdDigest": None,
        "provenanceQuality": "direct",
        "kind": "hermes_usage",
        "payload": {
            "requestIdDigest": _sha256(request_id),
            "intent": intent,
            "channel": channel,
            "owner": owner,
            "riskClass": risk_class,
            "outcome": outcome,
            "durationBucket": _duration_bucket(duration_seconds),
            "evidence": evidence,
        },
    }


def record_usage(**fields) -> None:
    """Append one hermes_usage record to the Skillfleet workflow journal, if configured.

    A journaling failure never changes the operator's result; it is logged so the
    daily reconciliation can surface it as an evidence gap instead of hiding it.
    """
    journal = os.environ.get("HERMES_OPERATOR_USAGE_JOURNAL")
    if not journal:
        return
    try:
        record = build_usage_record(observed_at=_utc_now(), **fields)
        path = Path(journal)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        line = json.dumps(record, separators=(",", ":")) + "\n"
        with path.open("a", encoding="utf-8") as handle:
            os.chmod(path, 0o600)
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handle.write(line)
            handle.flush()
    except Exception:
        _log.exception("hermes_usage journal append failed")


def _capture_occurred_at(request_id: str) -> str:
    """Persist transport time before sending so retries keep identical OODA input."""
    state_dir = Path(os.environ.get(
        "HERMES_OPERATOR_STATE_DIR", Path.home() / ".hermes" / "state" / "hermes-operator"
    ))
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = state_dir / "capture-times.json"
    lock_path = state_dir / "capture-times.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            if state_path.exists():
                values = json.loads(state_path.read_text(encoding="utf-8"))
                if not isinstance(values, dict) or not all(
                    isinstance(key, str) and isinstance(value, str)
                    for key, value in values.items()
                ):
                    raise ValueError("invalid capture timestamp state")
            else:
                values = {}
            occurred_at = values.get(request_id)
            if occurred_at is not None:
                return occurred_at
            occurred_at = _utc_now()
            values[request_id] = occurred_at
            if len(values) > 4096:
                values = dict(list(values.items())[-4096:])
            temporary = state_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(values, separators=(",", ":")), encoding="utf-8")
            os.chmod(temporary, 0o600)
            os.replace(temporary, state_path)
            return occurred_at
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _operator_url() -> str:
    value = os.environ["HERMES_BOB_OPERATOR_URL"]
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path != "/api/v1/hermes/operator"
    ):
        raise ValueError("HERMES_BOB_OPERATOR_URL is not a valid operator endpoint")
    return value


def _post_operator(body: dict) -> dict:
    request = Request(
        _operator_url(),
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {os.environ['HERMES_BOB_OPERATOR_API_KEY']}",
            "Content-Type": "application/json",
            "User-Agent": "hermes-operator/1.0",
        },
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        receipt = json.loads(response.read())
    if not isinstance(receipt, dict) or receipt.get("schemaVersion") != 1:
        raise ValueError("invalid operator response")
    return receipt


def _one_line(value: object, limit: int = 300) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("operator text is missing")
    return " ".join(value.split())[:limit]


def _format_item(item: object) -> str:
    if not isinstance(item, dict) or not isinstance(item.get("canonicalRef"), dict):
        raise ValueError("invalid briefing item")
    canonical_ref = item["canonicalRef"]
    return (
        f"- {_one_line(item.get('label'))} "
        f"[{_one_line(canonical_ref.get('kind'), 80)}:"
        f"{_one_line(canonical_ref.get('id'), 160)}]"
    )


def handle_capture(raw_args: str) -> str:
    """Capture one operator note in OODA."""
    text = raw_args.strip()
    if not text:
        return "Usage: /capture <note>"
    session = _session_env()
    platform = session.get("HERMES_SESSION_PLATFORM")
    chat_id = session.get("HERMES_SESSION_CHAT_ID")
    message_id = session.get("HERMES_SESSION_MESSAGE_ID")
    if platform != "telegram" or not chat_id or not message_id:
        record_usage(request_id=f"{platform or 'unknown'}:missing-context", intent="capture",
                     channel="telegram", outcome="blocked", duration_seconds=0, evidence="unknown")
        return "Capture unavailable: stable Telegram message context is missing."
    request_id = f"{platform}:{chat_id}:{message_id}"
    started = time.monotonic()
    try:
        body = {
            "schemaVersion": 1,
            "requestId": request_id,
            "intent": "capture",
            "channel": platform,
            "occurredAt": _capture_occurred_at(request_id),
            "payload": {"text": text},
        }
        receipt = _post_operator(body)

        summary = receipt["summary"]
        canonical_ref = receipt["canonicalRef"]
        if (
            receipt.get("schemaVersion") != 1
            or receipt.get("intent") != "capture.receipt"
            or not isinstance(summary, str)
            or not isinstance(canonical_ref, dict)
            or canonical_ref.get("kind") != "conversation_event"
            or not isinstance(canonical_ref.get("id"), str)
        ):
            raise ValueError("invalid capture receipt")
        record_usage(request_id=request_id, intent="capture", channel="telegram", outcome="success",
                     duration_seconds=time.monotonic() - started, evidence="complete")
        return f"{summary} [conversation_event:{canonical_ref['id']}]"
    except Exception:
        record_usage(request_id=request_id, intent="capture", channel="telegram", outcome="failure",
                     duration_seconds=time.monotonic() - started, evidence="unknown")
        return "Capture failed: Bob operator service is unavailable. Please retry."


def handle_scheduled(intent: str) -> str:
    """Run one fixed daily read/reflection intent for a no-agent cron job."""
    expected_intents = {
        "today": "today.brief",
        "close": "close.summary",
    }
    if intent not in expected_intents:
        raise ValueError("unsupported scheduled operator intent")
    occurred_at = _utc_now()
    body = {
        "schemaVersion": 1,
        "requestId": f"cron:{intent}:{occurred_at[:10]}",
        "intent": intent,
        "channel": "bob",
        "occurredAt": occurred_at,
        "payload": {},
    }
    started = time.monotonic()
    try:
        receipt = _post_operator(body)
        canonical_ref = receipt["canonicalRef"]
        summary = receipt["summary"]
        coverage = receipt["freshness"]["coverage"]
        if (
            receipt.get("intent") != expected_intents[intent]
            or not isinstance(summary, str)
            or not isinstance(canonical_ref, dict)
            or not isinstance(canonical_ref.get("kind"), str)
            or not isinstance(canonical_ref.get("id"), str)
            or coverage not in {"complete", "partial", "unknown"}
        ):
            raise ValueError("invalid scheduled operator response")
        lines = [
            f"{_one_line(summary)} "
            f"[{_one_line(canonical_ref['kind'], 80)}:"
            f"{_one_line(canonical_ref['id'], 160)}]",
            f"Coverage: {coverage}",
        ]
        data = receipt.get("data", {})
        if not isinstance(data, dict):
            raise ValueError("invalid briefing data")
        sections = data.get("sections", [])
        if intent == "today":
            if not isinstance(sections, list):
                raise ValueError("invalid morning sections")
            for section in sections[:8]:
                if not isinstance(section, dict) or not isinstance(section.get("items"), list):
                    raise ValueError("invalid morning section")
                source = _one_line(section.get("source"), 40).upper()
                section_coverage = section.get("coverage")
                total = section.get("total")
                shown = section.get("shown")
                if (
                    section_coverage not in {"complete", "partial", "unknown"}
                    or not isinstance(total, int)
                    or not isinstance(shown, int)
                ):
                    raise ValueError("invalid morning section metadata")
                lines.append(f"{source} ({shown}/{total}, {section_coverage})")
                lines.extend(_format_item(item) for item in section["items"][:10])
        elif not isinstance(sections, dict):
            raise ValueError("invalid evening sections")
        else:
            for category in ("completed", "blocked", "waiting", "captured", "tomorrow"):
                items = sections.get(category, [])
                if not isinstance(items, list):
                    raise ValueError("invalid evening section")
                lines.append(f"{category.upper()} ({len(items)})")
                lines.extend(_format_item(item) for item in items[:10])

        gaps = data.get("gaps", [])
        if isinstance(gaps, list) and gaps and all(isinstance(gap, str) for gap in gaps):
            lines.append(f"Gaps: {', '.join(_one_line(gap) for gap in gaps[:8])}")
        record_usage(request_id=body["requestId"], intent=intent, channel="bob", outcome="success",
                     duration_seconds=time.monotonic() - started, evidence=coverage)
        return "\n".join(lines)
    except Exception as error:
        record_usage(request_id=body["requestId"], intent=intent, channel="bob", outcome="failure",
                     duration_seconds=time.monotonic() - started, evidence="unknown")
        raise RuntimeError("Bob operator service is unavailable") from error


def register(ctx) -> None:
    ctx.register_hook("pre_gateway_dispatch", capture_gateway_context)
    ctx.register_command(
        "capture",
        handler=handle_capture,
        description="Capture a note in OODA through Bob.",
    )
