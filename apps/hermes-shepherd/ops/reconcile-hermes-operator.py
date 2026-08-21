#!/usr/bin/env python3
"""Reconcile Bob's fixed Hermes daily jobs by stable name."""

import json
from collections.abc import Callable
from typing import Any


DAILY_JOBS = (
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
)


def reconcile_daily_jobs(
    list_jobs: Callable[[], list[dict[str, Any]]],
    create_job: Callable[..., dict[str, Any]],
) -> dict[str, int]:
    existing_names = {
        job.get("name")
        for job in list_jobs()
        if isinstance(job, dict) and isinstance(job.get("name"), str)
    }
    created = 0
    existing = 0
    for definition in DAILY_JOBS:
        if definition["name"] in existing_names:
            existing += 1
            continue
        create_job(**definition)
        existing_names.add(definition["name"])
        created += 1
    return {"created": created, "existing": existing}


def main() -> None:
    from cron.jobs import list_jobs
    from cron.scheduler import create_job_with_scheduler_registration

    result = reconcile_daily_jobs(
        list_jobs,
        create_job_with_scheduler_registration,
    )
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
