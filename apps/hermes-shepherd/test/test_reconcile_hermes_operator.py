import importlib.util
import unittest
from pathlib import Path


RECONCILER_PATH = Path(__file__).parents[1] / "ops" / "reconcile-hermes-operator.py"
JOB_RUNNER_PATH = Path(__file__).parents[1] / "ops" / "hermes-operator-job.py"


def load_reconciler():
    spec = importlib.util.spec_from_file_location(
        "reconcile_hermes_operator", RECONCILER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_job_runner():
    spec = importlib.util.spec_from_file_location("hermes_operator_job", JOB_RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class HermesOperatorReconciliationTests(unittest.TestCase):
    def test_reconcile_creates_each_daily_job_once_across_restarts(self):
        reconciler = load_reconciler()
        jobs = []
        created = []

        def list_jobs():
            return list(jobs)

        def create_job(**definition):
            job = {"id": f"job-{len(jobs) + 1}", **definition}
            jobs.append(job)
            created.append(definition)
            return job

        first = reconciler.reconcile_daily_jobs(list_jobs, create_job, lambda *_: None, lambda *_: None)
        second = reconciler.reconcile_daily_jobs(list_jobs, create_job, lambda *_: None, lambda *_: None)

        self.assertEqual(first, {"created": 2, "existing": 0, "updated": 0, "removed": 0})
        self.assertEqual(second, {"created": 0, "existing": 2, "updated": 0, "removed": 0})
        self.assertEqual(
            created,
            [
                {
                    "name": "bob:operator:morning",
                    "prompt": "",
                    "schedule": "0 8 * * *",
                    "deliver": "telegram",
                    "script": "hermes-operator-today.py",
                    "no_agent": True,
                },
                {
                    "name": "bob:operator:evening",
                    "prompt": "",
                    "schedule": "0 18 * * *",
                    "deliver": "telegram",
                    "script": "hermes-operator-close.py",
                    "no_agent": True,
                },
            ],
        )

    def test_reconcile_repairs_drift_and_removes_duplicates(self):
        reconciler = load_reconciler()
        jobs = [
            {"id": "bad", **reconciler.DAILY_JOBS[0], "schedule": {"kind": "cron", "expr": "0 9 * * *"}},
            {"id": "duplicate", **reconciler.DAILY_JOBS[0]},
            {"id": "evening", **reconciler.DAILY_JOBS[1]},
        ]
        updated = []
        removed = []

        result = reconciler.reconcile_daily_jobs(
            lambda: jobs,
            lambda **_: self.fail("no create expected"),
            lambda job_id, definition: updated.append((job_id, definition)),
            lambda job_id: removed.append(job_id),
        )

        self.assertEqual(updated, [("bad", {**reconciler.DAILY_JOBS[0], "enabled": True})])
        self.assertEqual(removed, ["duplicate"])
        self.assertEqual(result, {"created": 0, "existing": 1, "updated": 1, "removed": 1})

    def test_reconcile_preserves_an_emergency_paused_job(self):
        reconciler = load_reconciler()
        paused = {
            "id": "paused", **reconciler.DAILY_JOBS[0], "enabled": False,
            "state": "paused", "schedule": {"kind": "cron", "expr": "0 9 * * *"},
        }
        updated = []

        result = reconciler.reconcile_daily_jobs(
            lambda: [paused], lambda **_: None,
            lambda job_id, definition: updated.append((job_id, definition)),
            lambda _: None,
        )

        self.assertEqual(updated, [("paused", reconciler.DAILY_JOBS[0])])
        self.assertNotIn("enabled", updated[0][1])
        self.assertNotIn("state", updated[0][1])
        self.assertEqual(result, {"created": 1, "existing": 0, "updated": 1, "removed": 0})

    def test_job_entrypoint_maps_fixed_filename_to_operator_intent(self):
        runner = load_job_runner()
        calls = []

        class Plugin:
            @staticmethod
            def handle_scheduled(intent):
                calls.append(intent)
                return f"receipt:{intent}"

        output = []
        runner.run_job(
            "/home/bob/.hermes/scripts/hermes-operator-today.py",
            load_plugin=lambda: Plugin,
            emit=output.append,
        )
        runner.run_job(
            "/home/bob/.hermes/scripts/hermes-operator-close.py",
            load_plugin=lambda: Plugin,
            emit=output.append,
        )

        self.assertEqual(calls, ["today", "close"])
        self.assertEqual(output, ["receipt:today", "receipt:close"])


if __name__ == "__main__":
    unittest.main()
