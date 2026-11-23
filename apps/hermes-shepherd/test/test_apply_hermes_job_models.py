import importlib.util
import unittest
from pathlib import Path


APPLY_PATH = Path(__file__).parents[1] / "ops" / "apply-hermes-job-models.py"
PINS = {
    "jobs": [
        {"name": "Morning briefing", "provider": "openai-codex", "model": "gpt-5.6-terra"},
        {"name": "Nightly vault wrap-up", "provider": "openai-codex", "model": "gpt-5.6-terra"},
    ]
}


def load_apply():
    spec = importlib.util.spec_from_file_location("apply_hermes_job_models", APPLY_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def live(name, model, provider="openai-codex", job_id=None):
    return {"id": job_id or name[:4], "name": name, "model": model, "provider": provider}


class ApplyHermesJobModelsTests(unittest.TestCase):
    def setUp(self):
        self.apply = load_apply()

    def test_matching_pins_plan_no_updates(self):
        jobs = [live("Morning briefing", "gpt-5.6-terra"), live("Nightly vault wrap-up", "gpt-5.6-terra")]
        self.assertEqual(self.apply.plan_updates(jobs, PINS), [])

    def test_drifted_model_or_provider_is_planned(self):
        jobs = [
            live("Morning briefing", "gpt-5.4", job_id="m1"),
            live("Nightly vault wrap-up", "gpt-5.6-terra", provider=None, job_id="n1"),
        ]
        self.assertEqual(
            self.apply.plan_updates(jobs, PINS),
            [
                ("m1", {"provider": "openai-codex", "model": "gpt-5.6-terra"}),
                ("n1", {"provider": "openai-codex", "model": "gpt-5.6-terra"}),
            ],
        )

    def test_missing_or_duplicate_job_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Nightly vault wrap-up"):
            self.apply.plan_updates([live("Morning briefing", "gpt-5.6-terra")], PINS)
        with self.assertRaisesRegex(ValueError, "Morning briefing"):
            self.apply.plan_updates(
                [
                    live("Morning briefing", "gpt-5.6-terra", job_id="a"),
                    live("Morning briefing", "gpt-5.6-terra", job_id="b"),
                    live("Nightly vault wrap-up", "gpt-5.6-terra"),
                ],
                PINS,
            )

    def test_check_mode_reports_drift_without_writing(self):
        jobs = [live("Morning briefing", "gpt-5.4", job_id="m1"), live("Nightly vault wrap-up", "gpt-5.6-terra")]
        writes = []
        code = self.apply.run(jobs, PINS, update_job=lambda *a: writes.append(a), check=True, emit=lambda _l: None)
        self.assertEqual(code, 1)
        self.assertEqual(writes, [])

    def test_apply_mode_writes_only_drift(self):
        jobs = [live("Morning briefing", "gpt-5.4", job_id="m1"), live("Nightly vault wrap-up", "gpt-5.6-terra")]
        writes = []
        code = self.apply.run(jobs, PINS, update_job=lambda *a: writes.append(a), check=False, emit=lambda _l: None)
        self.assertEqual(code, 0)
        self.assertEqual(writes, [("m1", {"provider": "openai-codex", "model": "gpt-5.6-terra"})])


if __name__ == "__main__":
    unittest.main()
