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
    update_job: Callable[[str, dict[str, Any]], Any],
    remove_job: Callable[[str], Any],
) -> dict[str, int]:
    created = 0
    existing = 0
    updated = 0
    removed = 0
    jobs_by_name: dict[str, list[dict[str, Any]]] = {}
    for job in list_jobs():
        if isinstance(job, dict) and isinstance(job.get("name"), str):
            jobs_by_name.setdefault(job["name"], []).append(job)

    def matches(job: dict[str, Any], definition: dict[str, Any]) -> bool:
        schedule = job.get("schedule")
        schedule_expr = schedule.get("expr") if isinstance(schedule, dict) else schedule
        return (
            schedule_expr == definition["schedule"]
            and all(job.get(field) == definition[field]
                    for field in ("prompt", "deliver", "script", "no_agent"))
        )

    def paused(job: dict[str, Any]) -> bool:
        return (job.get("enabled") is False or job.get("state") == "paused"
                or job.get("paused") is True)

    for definition in DAILY_JOBS:
        matches_name = jobs_by_name.get(definition["name"], [])
        if not matches_name:
            create_job(**definition)
            created += 1
            continue
        matches_name.sort(key=lambda job: not paused(job))
        canonical, *duplicates = matches_name
        canonical_id = canonical.get("id")
        if not isinstance(canonical_id, str):
            raise ValueError("Hermes job is missing an ID")
        if matches(canonical, definition):
            existing += 1
        else:
            # Repair declarative drift even while an operator has paused a job.
            # Omitting lifecycle fields lets Hermes retain the emergency pause;
            # active jobs are explicitly re-enabled to repair accidental drift.
            updates = dict(definition)
            if not paused(canonical):
                updates["enabled"] = True
            update_job(canonical_id, updates)
            updated += 1
        for duplicate in duplicates:
            duplicate_id = duplicate.get("id")
            if not isinstance(duplicate_id, str):
                raise ValueError("duplicate Hermes job is missing an ID")
            remove_job(duplicate_id)
            removed += 1
    return {"created": created, "existing": existing, "updated": updated, "removed": removed}


def main() -> None:
    from cron.jobs import list_jobs, remove_job, update_job
    from cron.scheduler import create_job_with_scheduler_registration

    result = reconcile_daily_jobs(
        lambda: list_jobs(include_disabled=True),
        create_job_with_scheduler_registration,
        update_job,
        remove_job,
    )
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
