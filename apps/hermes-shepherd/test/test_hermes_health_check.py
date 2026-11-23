import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


CHECK_PATH = Path(__file__).parents[1] / "ops" / "hermes-health-check.py"
NOW = datetime(2026, 11, 22, 15, 30, tzinfo=timezone.utc)  # 07:30 America/Los_Angeles
TODAY = "2026-11-22"
REJECTION = (
    "RuntimeError: HTTP 400: The 'gpt-5.4' model is not supported when using "
    "Codex with a ChatGPT account."
)


def load_check():
    spec = importlib.util.spec_from_file_location("hermes_health_check", CHECK_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def job(name, *, status="ok", error=None, ran_hours_ago=1.0, enabled=True, no_agent=False):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "enabled": enabled,
        "state": "scheduled" if enabled else "paused",
        "no_agent": no_agent,
        "model": None if no_agent else "gpt-5.6-terra",
        "provider": None if no_agent else "openai-codex",
        "last_run_at": (NOW - timedelta(hours=ran_hours_ago)).isoformat(),
        "last_status": status,
        "last_error": error,
        "failure_streak": 0 if status == "ok" else 3,
    }


def healthy_jobs():
    return [
        job("Morning briefing", ran_hours_ago=0.5),
        job("Nightly vault wrap-up", ran_hours_ago=9.5),
        job("bob:operator:morning", no_agent=True, ran_hours_ago=23.5),
    ]


class HermesHealthCheckTests(unittest.TestCase):
    def setUp(self):
        self.check = load_check()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.hermes_home = root / "hermes"
        (self.hermes_home / "cron").mkdir(parents=True)
        self.vault = root / "vault"
        (self.vault / "Daily").mkdir(parents=True)
        self.sent = []
        self.logged = []

    def tearDown(self):
        self.tmp.cleanup()

    def write_jobs(self, jobs):
        path = self.hermes_home / "cron" / "jobs.json"
        path.write_text(json.dumps({"jobs": jobs, "updated_at": NOW.isoformat()}))
        return path

    def write_note(self, day=TODAY):
        (self.vault / "Daily" / f"{day}.md").write_text("# Briefing\n")

    def run_check(self, *extra, send=None):
        argv = ["--hermes-home", str(self.hermes_home), "--vault", str(self.vault), *extra]
        return self.check.main(
            argv,
            now=NOW,
            send=send or self.sent.append,
            log=lambda priority, message: self.logged.append((priority, message)),
        )

    def test_healthy_state_sends_nothing_and_exits_zero(self):
        self.write_jobs(healthy_jobs())
        self.write_note()
        self.assertEqual(self.run_check(), 0)
        self.assertEqual(self.sent, [])
        self.assertTrue(any(p == "info" for p, _ in self.logged))

    def test_model_rejection_alerts_within_one_run(self):
        jobs = healthy_jobs()
        jobs[1] = job("Nightly vault wrap-up", status="error", error=REJECTION)
        self.write_jobs(jobs)
        self.write_note()
        self.assertEqual(self.run_check(), 1)
        self.assertEqual(len(self.sent), 1)
        alert = self.sent[0]
        self.assertIn("Nightly vault wrap-up", alert)
        self.assertIn("model rejected", alert)
        self.assertIn("gpt-5.6-terra", alert)
        self.assertTrue(any(p == "alert" and "model rejected" in m for p, m in self.logged))

    def test_model_rejection_is_classified_for_common_provider_wordings(self):
        for error in (
            REJECTION,
            "openai.NotFoundError: Error code: 404 - model_not_found",
            "HTTP 400: The model `gpt-9` does not exist or you do not have access to it.",
            "Unknown model: gpt-5.4-mini",
        ):
            with self.subTest(error=error):
                self.assertTrue(self.check.is_model_rejection(error))
        self.assertFalse(self.check.is_model_rejection("TimeoutError: read timed out"))

    def test_other_job_failures_also_alert(self):
        jobs = healthy_jobs()
        jobs[0] = job("Morning briefing", status="error", error="TimeoutError: read timed out", ran_hours_ago=0.5)
        self.write_jobs(jobs)
        self.write_note()
        self.assertEqual(self.run_check(), 1)
        self.assertIn("Morning briefing", self.sent[0])
        self.assertIn("failed", self.sent[0])
        self.assertNotIn("model rejected", self.sent[0])

    def test_missing_daily_note_alerts(self):
        self.write_jobs(healthy_jobs())
        self.assertEqual(self.run_check(), 1)
        self.assertIn(f"Daily/{TODAY}.md", self.sent[0])

    def test_no_briefing_run_for_a_day_alerts(self):
        jobs = healthy_jobs()
        jobs[0] = job("Morning briefing", ran_hours_ago=49)
        self.write_jobs(jobs)
        self.write_note()
        self.assertEqual(self.run_check(), 1)
        self.assertIn("has not run", self.sent[0])

    def test_missing_or_paused_briefing_job_alerts(self):
        for jobs in (
            healthy_jobs()[1:],
            [job("Morning briefing", enabled=False), *healthy_jobs()[1:]],
        ):
            with self.subTest(names=[j["name"] for j in jobs]):
                self.sent.clear()
                self.write_jobs(jobs)
                self.write_note()
                self.assertEqual(self.run_check(), 1)
                self.assertIn("Morning briefing", self.sent[0])

    def test_unreadable_jobs_file_alerts(self):
        (self.hermes_home / "cron" / "jobs.json").write_text("{not json")
        self.write_note()
        self.assertEqual(self.run_check(), 1)
        self.assertIn("jobs.json", self.sent[0])

    def test_paused_job_errors_do_not_alert(self):
        jobs = healthy_jobs()
        jobs.append(job("Old experiment", status="error", error=REJECTION, enabled=False))
        self.write_jobs(jobs)
        self.write_note()
        self.assertEqual(self.run_check(), 0)
        self.assertEqual(self.sent, [])

    def test_failed_alert_delivery_is_a_distinct_failure(self):
        jobs = healthy_jobs()
        jobs[1] = job("Nightly vault wrap-up", status="error", error=REJECTION)
        self.write_jobs(jobs)
        self.write_note()

        def broken_send(_body):
            raise OSError("telegram unreachable")

        self.assertEqual(self.run_check(send=broken_send), 2)
        self.assertTrue(any(p == "alert" and "delivery failed" in m for p, m in self.logged))

    def test_dry_run_reports_without_sending(self):
        self.write_jobs(healthy_jobs())
        self.assertEqual(self.run_check("--dry-run"), 1)
        self.assertEqual(self.sent, [])
        self.assertTrue(any("dry run" in m for _, m in self.logged))

    def test_simulated_rejection_fixture_is_labelled_as_a_test(self):
        jobs = healthy_jobs()
        jobs[1] = job("Nightly vault wrap-up", status="error", error=REJECTION)
        fixture = Path(self.tmp.name) / "simulated-jobs.json"
        fixture.write_text(json.dumps({"jobs": jobs}))
        self.write_jobs(healthy_jobs())
        self.write_note()
        self.assertEqual(self.run_check("--jobs-file", str(fixture), "--label", "TEST"), 1)
        self.assertTrue(self.sent[0].startswith("[TEST] "))
        self.assertIn("model rejected", self.sent[0])

    def test_alert_text_is_bounded(self):
        jobs = healthy_jobs()
        jobs[1] = job("Nightly vault wrap-up", status="error", error="model not supported " + "x" * 5000)
        self.write_jobs(jobs)
        self.write_note()
        self.run_check()
        self.assertLess(len(self.sent[0]), 2000)


if __name__ == "__main__":
    unittest.main()
