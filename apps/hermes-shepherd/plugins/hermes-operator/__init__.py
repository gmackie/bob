"""Native Hermes commands for Bob's operator plane."""

import json
import os
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def _session_env() -> dict[str, str]:
    from gateway.session_context import get_session_env

    return get_session_env()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
        return "Capture unavailable: stable Telegram message context is missing."
    try:
        body = {
            "schemaVersion": 1,
            "requestId": f"{platform}:{chat_id}:{message_id}",
            "intent": "capture",
            "channel": platform,
            "occurredAt": _utc_now(),
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
        return f"{summary} [conversation_event:{canonical_ref['id']}]"
    except Exception:
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
        return "\n".join(lines)
    except Exception as error:
        raise RuntimeError("Bob operator service is unavailable") from error


def register(ctx) -> None:
    ctx.register_command(
        "capture",
        handler=handle_capture,
        description="Capture a note in OODA through Bob.",
    )
