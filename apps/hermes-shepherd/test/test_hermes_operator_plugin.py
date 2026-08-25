import importlib.util
import json
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from types import ModuleType, SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError


PLUGIN_PATH = (
    Path(__file__).parents[1] / "plugins" / "hermes-operator" / "__init__.py"
)
PLUGIN_MANIFEST_PATH = PLUGIN_PATH.with_name("plugin.yaml")


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_operator_plugin", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakePluginContext:
    def __init__(self):
        self.commands = []
        self.hooks = []

    def register_command(self, name, handler, description="", args_hint=""):
        self.commands.append(
            {
                "name": name,
                "handler": handler,
                "description": description,
                "args_hint": args_hint,
            }
        )

    def register_hook(self, name, handler):
        self.hooks.append({"name": name, "handler": handler})


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
    def test_manifest_declares_predispatch_hook(self):
        manifest = PLUGIN_MANIFEST_PATH.read_text(encoding="utf-8")

        self.assertIn("provides_hooks:\n  - pre_gateway_dispatch\n", manifest)

    def test_reads_each_gateway_session_context_value_by_name(self):
        plugin = load_plugin()
        gateway_module = ModuleType("gateway")
        session_context_module = ModuleType("gateway.session_context")
        requested = []

        def get_session_env(name, default=""):
            requested.append((name, default))
            return f"value:{name}"

        session_context_module.get_session_env = get_session_env
        with patch.dict(sys.modules, {
            "gateway": gateway_module,
            "gateway.session_context": session_context_module,
        }):
            session = plugin._session_env()

        self.assertEqual(session, {
            "HERMES_SESSION_PLATFORM": "value:HERMES_SESSION_PLATFORM",
            "HERMES_SESSION_CHAT_ID": "value:HERMES_SESSION_CHAT_ID",
            "HERMES_SESSION_MESSAGE_ID": "value:HERMES_SESSION_MESSAGE_ID",
        })
        self.assertEqual(requested, [
            ("HERMES_SESSION_PLATFORM", ""),
            ("HERMES_SESSION_CHAT_ID", ""),
            ("HERMES_SESSION_MESSAGE_ID", ""),
        ])

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
        self.assertEqual(len(context.hooks), 1)
        self.assertEqual(context.hooks[0]["name"], "pre_gateway_dispatch")

    def test_predispatch_context_bridges_transport_identity_before_session_binding(self):
        plugin = load_plugin()
        event = SimpleNamespace(
            message_id="9918",
            source=SimpleNamespace(
                platform=SimpleNamespace(value="telegram"),
                chat_id="4512",
                message_id=None,
            ),
        )

        result = plugin.capture_gateway_context(event=event)

        self.assertIsNone(result)
        gateway_module = ModuleType("gateway")
        session_context_module = ModuleType("gateway.session_context")
        session_context_module.get_session_env = lambda _name, default="": default
        with patch.dict(sys.modules, {
            "gateway": gateway_module,
            "gateway.session_context": session_context_module,
        }):
            self.assertEqual(plugin._session_env(), {
                "HERMES_SESSION_PLATFORM": "telegram",
                "HERMES_SESSION_CHAT_ID": "4512",
                "HERMES_SESSION_MESSAGE_ID": "9918",
            })

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


class HermesUsageJournalTests(unittest.TestCase):
    RECEIPT = {
        "schemaVersion": 1,
        "intent": "capture.receipt",
        "summary": "Captured in OODA.",
        "canonicalRef": {"kind": "conversation_event", "id": "event-42"},
    }
    SESSION = {
        "HERMES_SESSION_PLATFORM": "telegram",
        "HERMES_SESSION_CHAT_ID": "4512",
        "HERMES_SESSION_MESSAGE_ID": "9918",
    }

    def _env(self, state_dir, journal):
        return {
            "HERMES_BOB_OPERATOR_URL": "https://bob.example.com/api/v1/hermes/operator",
            "HERMES_BOB_OPERATOR_API_KEY": "bob_test_key",
            "HERMES_OPERATOR_STATE_DIR": state_dir,
            **({"HERMES_OPERATOR_USAGE_JOURNAL": journal} if journal else {}),
        }

    def _read(self, journal):
        return [json.loads(line) for line in Path(journal).read_text(encoding="utf-8").splitlines()]

    def test_capture_appends_one_digest_only_usage_record(self):
        plugin = load_plugin()
        with tempfile.TemporaryDirectory() as state_dir:
            journal = str(Path(state_dir) / "workflows" / "bob.jsonl")
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, journal), clear=True),
                patch.object(plugin, "_session_env", return_value=self.SESSION),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T13:30:00Z"),
                patch.object(plugin, "urlopen", side_effect=lambda *_a, **_k: FakeHttpResponse(self.RECEIPT)),
            ):
                plugin.handle_capture("Remember the lab workflow. Contact private@example.com")
            records = self._read(journal)
            mode = Path(journal).stat().st_mode & 0o777

        self.assertEqual(mode, 0o600)
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(sorted(record), [
            "kind", "observedAt", "payload", "projectIdDigest", "provenanceQuality",
            "recordId", "schemaVersion", "sessionIdDigest", "source",
        ])
        self.assertEqual(record["kind"], "hermes_usage")
        self.assertEqual(record["source"], "bob")
        self.assertEqual(record["observedAt"], "2026-08-24T13:30:00Z")
        self.assertRegex(record["recordId"], r"^sha256:[a-f0-9]{64}$")
        self.assertEqual(record["payload"], {
            "requestIdDigest": plugin._sha256("telegram:4512:9918"),
            "intent": "capture",
            "channel": "telegram",
            "owner": "ooda",
            "riskClass": "R1",
            "outcome": "success",
            "durationBucket": "<1s",
            "evidence": "complete",
        })
        serialized = json.dumps(record)
        for forbidden in ("Remember", "private@example.com", "4512", "9918", "event-42"):
            self.assertNotIn(forbidden, serialized)

    def test_failed_and_blocked_captures_are_recorded_as_such(self):
        plugin = load_plugin()

        def failing(*_a, **_k):
            raise URLError("down")

        with tempfile.TemporaryDirectory() as state_dir:
            journal = str(Path(state_dir) / "bob.jsonl")
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, journal), clear=True),
                patch.object(plugin, "_session_env", return_value=self.SESSION),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T13:30:00Z"),
                patch.object(plugin, "urlopen", side_effect=failing),
            ):
                plugin.handle_capture("note")
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, journal), clear=True),
                patch.object(plugin, "_session_env", return_value={"HERMES_SESSION_PLATFORM": "telegram"}),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T13:31:00Z"),
            ):
                plugin.handle_capture("note")
            records = self._read(journal)

        self.assertEqual([r["payload"]["outcome"] for r in records], ["failure", "blocked"])
        self.assertEqual([r["payload"]["evidence"] for r in records], ["unknown", "unknown"])
        self.assertNotEqual(records[0]["recordId"], records[1]["recordId"])

    def test_scheduled_intents_record_bob_channel_with_receipt_coverage(self):
        plugin = load_plugin()
        receipt = {
            "schemaVersion": 1,
            "intent": "close.summary",
            "summary": "Closed the day.",
            "canonicalRef": {"kind": "reflection", "id": "r-1"},
            "freshness": {"coverage": "partial"},
            "data": {"sections": {"completed": [], "blocked": [], "waiting": [], "captured": [], "tomorrow": []}},
        }
        with tempfile.TemporaryDirectory() as state_dir:
            journal = str(Path(state_dir) / "bob.jsonl")
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, journal), clear=True),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T01:00:00Z"),
                patch.object(plugin, "urlopen", side_effect=lambda *_a, **_k: FakeHttpResponse(receipt)),
            ):
                plugin.handle_scheduled("close")
            records = self._read(journal)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["payload"]["intent"], "close")
        self.assertEqual(records[0]["payload"]["channel"], "bob")
        self.assertEqual(records[0]["payload"]["owner"], "ooda")
        self.assertEqual(records[0]["payload"]["riskClass"], "R0")
        self.assertEqual(records[0]["payload"]["outcome"], "success")
        self.assertEqual(records[0]["payload"]["evidence"], "partial")
        self.assertEqual(records[0]["payload"]["requestIdDigest"], plugin._sha256("cron:close:2026-08-24"))

    def test_usage_journal_is_optional_and_never_breaks_the_command(self):
        plugin = load_plugin()
        with tempfile.TemporaryDirectory() as state_dir:
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, None), clear=True),
                patch.object(plugin, "_session_env", return_value=self.SESSION),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T13:30:00Z"),
                patch.object(plugin, "urlopen", side_effect=lambda *_a, **_k: FakeHttpResponse(self.RECEIPT)),
            ):
                result = plugin.handle_capture("note")
            self.assertEqual(result, "Captured in OODA. [conversation_event:event-42]")
            self.assertEqual(sorted(p.name for p in Path(state_dir).iterdir()), ["capture-times.json", "capture-times.lock"])

            unwritable = str(Path(state_dir) / "capture-times.json" / "bob.jsonl")
            with (
                patch.dict(plugin.os.environ, self._env(state_dir, unwritable), clear=True),
                patch.object(plugin, "_session_env", return_value=self.SESSION),
                patch.object(plugin, "_utc_now", return_value="2026-08-24T13:30:00Z"),
                patch.object(plugin, "urlopen", side_effect=lambda *_a, **_k: FakeHttpResponse(self.RECEIPT)),
                self.assertLogs("hermes_operator.usage", level="ERROR"),
            ):
                result = plugin.handle_capture("note")
            self.assertEqual(result, "Captured in OODA. [conversation_event:event-42]")


if __name__ == "__main__":
    unittest.main()
