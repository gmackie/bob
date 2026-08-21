import importlib.util
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError


PLUGIN_PATH = (
    Path(__file__).parents[1] / "plugins" / "hermes-operator" / "__init__.py"
)


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_operator_plugin", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakePluginContext:
    def __init__(self):
        self.commands = []

    def register_command(self, name, handler, description="", args_hint=""):
        self.commands.append(
            {
                "name": name,
                "handler": handler,
                "description": description,
                "args_hint": args_hint,
            }
        )


class FakeHttpResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class HermesOperatorPluginTests(unittest.TestCase):
    def test_registers_native_capture_command(self):
        plugin = load_plugin()
        context = FakePluginContext()

        plugin.register(context)

        self.assertEqual(len(context.commands), 1)
        command = context.commands[0]
        self.assertEqual(command["name"], "capture")
        self.assertIs(command["handler"], plugin.handle_capture)
        self.assertEqual(command["args_hint"], "")
        self.assertIn("OODA", command["description"])

    def test_capture_posts_stable_transport_request_and_returns_receipt(self):
        plugin = load_plugin()
        sent = []

        def open_request(request, timeout):
            sent.append((request, timeout))
            return FakeHttpResponse(
                {
                    "schemaVersion": 1,
                    "intent": "capture.receipt",
                    "summary": "Captured in OODA.",
                    "canonicalRef": {
                        "kind": "conversation_event",
                        "id": "event-42",
                    },
                }
            )

        session = {
            "HERMES_SESSION_PLATFORM": "telegram",
            "HERMES_SESSION_CHAT_ID": "4512",
            "HERMES_SESSION_MESSAGE_ID": "9918",
        }
        with (
            tempfile.TemporaryDirectory() as state_dir,
            patch.dict(
                plugin.os.environ,
                {
                    "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
                    "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
                    "HERMES_OPERATOR_STATE_DIR": state_dir,
                },
                clear=True,
            ),
            patch.object(plugin, "_session_env", return_value=session),
            patch.object(plugin, "_utc_now", return_value="2026-08-21T13:30:00Z"),
            patch.object(plugin, "urlopen", side_effect=open_request),
        ):
            result = plugin.handle_capture("Remember the lab workflow.")

        self.assertEqual(result, "Captured in OODA. [conversation_event:event-42]")
        self.assertEqual(len(sent), 1)
        request, timeout = sent[0]
        self.assertEqual(timeout, 10)
        self.assertEqual(request.full_url, "https://bob.example.com/api/v1/hermes/operator")
        self.assertEqual(request.get_header("Authorization"), "Bearer bob_test_key")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(request.get_header("User-agent"), "hermes-operator/1.0")
        self.assertEqual(
            json.loads(request.data),
            {
                "schemaVersion": 1,
                "requestId": "telegram:4512:9918",
                "intent": "capture",
                "channel": "telegram",
                "occurredAt": "2026-08-21T13:30:00Z",
                "payload": {"text": "Remember the lab workflow."},
            },
        )

    def test_capture_retry_reuses_the_persisted_occurred_at(self):
        plugin = load_plugin()
        sent = []
        session = {
            "HERMES_SESSION_PLATFORM": "telegram",
            "HERMES_SESSION_CHAT_ID": "4512",
            "HERMES_SESSION_MESSAGE_ID": "9918",
        }

        def open_request(request, timeout):
            sent.append(json.loads(request.data))
            return FakeHttpResponse({
                "schemaVersion": 1,
                "intent": "capture.receipt",
                "summary": "Captured in OODA.",
                "canonicalRef": {"kind": "conversation_event", "id": "event-42"},
            })

        with (
            tempfile.TemporaryDirectory() as state_dir,
            patch.dict(plugin.os.environ, {
                "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
                "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
                "HERMES_OPERATOR_STATE_DIR": state_dir,
            }, clear=True),
            patch.object(plugin, "_session_env", return_value=session),
            patch.object(plugin, "_utc_now", side_effect=[
                "2026-08-21T13:30:00Z", "2026-08-21T13:31:00Z",
            ]),
            patch.object(plugin, "urlopen", side_effect=open_request),
        ):
            plugin.handle_capture("Remember the lab workflow.")
            plugin.handle_capture("Remember the lab workflow.")

        self.assertEqual(sent[0]["occurredAt"], "2026-08-21T13:30:00Z")
        self.assertEqual(sent[1]["occurredAt"], sent[0]["occurredAt"])

    def test_capture_timestamp_journal_serializes_concurrent_writers(self):
        plugin = load_plugin()
        with tempfile.TemporaryDirectory() as state_dir, patch.dict(
            plugin.os.environ, {"HERMES_OPERATOR_STATE_DIR": state_dir}, clear=True
        ):
            with ThreadPoolExecutor(max_workers=8) as pool:
                values = list(pool.map(
                    plugin._capture_occurred_at,
                    [f"telegram:4512:{index}" for index in range(32)],
                ))
            state = json.loads(
                (Path(state_dir) / "capture-times.json").read_text(encoding="utf-8")
            )

        self.assertEqual(len(values), 32)
        self.assertEqual(len(state), 32)

    def test_capture_fails_closed_without_stable_telegram_message_context(self):
        plugin = load_plugin()

        with (
            patch.object(
                plugin,
                "_session_env",
                return_value={
                    "HERMES_SESSION_PLATFORM": "telegram",
                    "HERMES_SESSION_CHAT_ID": "4512",
                },
            ),
            patch.object(plugin, "urlopen") as open_request,
        ):
            result = plugin.handle_capture("Remember the lab workflow.")

        self.assertEqual(
            result,
            "Capture unavailable: stable Telegram message context is missing.",
        )
        open_request.assert_not_called()

    def test_capture_rejects_empty_text_before_calling_bob(self):
        plugin = load_plugin()

        with (
            patch.object(
                plugin,
                "_session_env",
                return_value={
                    "HERMES_SESSION_PLATFORM": "telegram",
                    "HERMES_SESSION_CHAT_ID": "4512",
                    "HERMES_SESSION_MESSAGE_ID": "9918",
                },
            ),
            patch.object(plugin, "urlopen") as open_request,
        ):
            result = plugin.handle_capture("   ")

        self.assertEqual(result, "Usage: /capture <note>")
        open_request.assert_not_called()

    def test_capture_sanitizes_upstream_failures(self):
        plugin = load_plugin()
        session = {
            "HERMES_SESSION_PLATFORM": "telegram",
            "HERMES_SESSION_CHAT_ID": "4512",
            "HERMES_SESSION_MESSAGE_ID": "9918",
        }

        with (
            patch.dict(
                plugin.os.environ,
                {
                    "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
                    "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
                },
                clear=True,
            ),
            patch.object(plugin, "_session_env", return_value=session),
            patch.object(
                plugin,
                "urlopen",
                side_effect=URLError("private upstream response"),
            ),
        ):
            result = plugin.handle_capture("Remember the lab workflow.")

        self.assertEqual(
            result,
            "Capture failed: Bob operator service is unavailable. Please retry.",
        )
        self.assertNotIn("private upstream response", result)

    def test_scheduled_today_uses_daily_idempotency_key_and_bob_channel(self):
        plugin = load_plugin()
        sent = []

        def open_request(request, timeout):
            sent.append(request)
            return FakeHttpResponse(
                {
                    "schemaVersion": 1,
                    "intent": "today.brief",
                    "summary": "Morning brief assembled from canonical sources.",
                    "canonicalRef": {
                        "kind": "briefing",
                        "id": "morning:2026-08-21",
                    },
                    "freshness": {"coverage": "partial"},
                    "data": {
                        "sections": [
                            {
                                "source": "ooda",
                                "coverage": "complete",
                                "total": 2,
                                "shown": 1,
                                "items": [
                                    {
                                        "label": "Review the lab workflow",
                                        "canonicalRef": {
                                            "kind": "work-item",
                                            "id": "work-42",
                                        },
                                    }
                                ],
                            }
                        ],
                        "gaps": ["forgegraph did not report"],
                    },
                }
            )

        with (
            patch.dict(
                plugin.os.environ,
                {
                    "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
                    "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
                },
                clear=True,
            ),
            patch.object(plugin, "_utc_now", return_value="2026-08-21T12:00:00Z"),
            patch.object(plugin, "urlopen", side_effect=open_request),
        ):
            result = plugin.handle_scheduled("today")

        self.assertEqual(
            result,
            "Morning brief assembled from canonical sources. "
            "[briefing:morning:2026-08-21]\n"
            "Coverage: partial\n"
            "OODA (1/2, complete)\n"
            "- Review the lab workflow [work-item:work-42]\n"
            "Gaps: forgegraph did not report",
        )
        self.assertEqual(len(sent), 1)
        self.assertEqual(
            json.loads(sent[0].data),
            {
                "schemaVersion": 1,
                "requestId": "cron:today:2026-08-21",
                "intent": "today",
                "channel": "bob",
                "occurredAt": "2026-08-21T12:00:00Z",
                "payload": {},
            },
        )

    def test_scheduled_close_preserves_categories_and_proposal_evidence(self):
        plugin = load_plugin()
        receipt = {
            "schemaVersion": 1,
            "intent": "close.summary",
            "summary": "Evening close assembled from canonical evidence and proposals.",
            "canonicalRef": {"kind": "briefing", "id": "evening:2026-08-21"},
            "freshness": {"coverage": "complete"},
            "data": {
                "sections": {
                    "completed": [],
                    "blocked": [],
                    "waiting": [],
                    "captured": [],
                    "tomorrow": [
                        {
                            "label": "Qualify the Hermes deployment",
                            "canonicalRef": {
                                "kind": "proposal",
                                "id": "proposal-42",
                            },
                            "proposed": True,
                        }
                    ],
                }
            },
        }
        with (
            patch.dict(
                plugin.os.environ,
                {
                    "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
                    "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
                },
                clear=True,
            ),
            patch.object(plugin, "_utc_now", return_value="2026-08-21T22:00:00Z"),
            patch.object(plugin, "urlopen", return_value=FakeHttpResponse(receipt)),
        ):
            result = plugin.handle_scheduled("close")

        self.assertIn("TOMORROW (1)", result)
        self.assertIn(
            "- Qualify the Hermes deployment [proposal:proposal-42]",
            result,
        )


if __name__ == "__main__":
    unittest.main()
