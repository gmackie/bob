#!/usr/bin/env python3
"""Pin Hermes's model-using cron jobs to the provider/model in hermes-config/job-models.json.

BOB-108. Jobs created without a pin snapshot the global model at creation time and
are drift-skipped (or rejected) when that model changes or is retired. BOB-105
pinned both daily jobs by hand; this makes the pins declarative. Only drifted
fields are written, through Hermes's own cron.jobs.update_job, so an unchanged
live state is a no-op.

Usage (as bob, with PYTHONPATH=$HERMES_HOME/hermes-agent):
  apply-hermes-job-models.py PINS_JSON [--check]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

PINNED_FIELDS = ("provider", "model")


def plan_updates(jobs: list[dict[str, Any]], pins: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    plan: list[tuple[str, dict[str, Any]]] = []
    for pin in pins["jobs"]:
        name = pin["name"]
        matches = [job for job in jobs if isinstance(job, dict) and job.get("name") == name]
        if len(matches) != 1:
            raise ValueError(f"expected exactly one Hermes job named {name!r}, found {len(matches)}")
        job = matches[0]
        if not isinstance(job.get("id"), str):
            raise ValueError(f"Hermes job {name!r} is missing an ID")
        if any(job.get(field) != pin[field] for field in PINNED_FIELDS):
            plan.append((job["id"], {field: pin[field] for field in PINNED_FIELDS}))
    return plan


def run(
    jobs: list[dict[str, Any]],
    pins: dict[str, Any],
    *,
    update_job: Callable[[str, dict[str, Any]], Any],
    check: bool,
    emit: Callable[[str], None] = print,
) -> int:
    plan = plan_updates(jobs, pins)
    names = {job.get("id"): job.get("name") for job in jobs if isinstance(job, dict)}
    if not plan:
        emit("job models: unchanged")
        return 0
    for job_id, updates in plan:
        desc = ", ".join(f"{k}={v}" for k, v in updates.items())
        emit(f"job models: {'drift' if check else 'pinning'} {names.get(job_id)!r} -> {desc}")
        if not check:
            update_job(job_id, updates)
    return 1 if check else 0


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__, file=sys.stderr)
        return 64
    pins = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    from cron.jobs import list_jobs, update_job

    return run(list_jobs(include_disabled=True), pins, update_job=update_job, check="--check" in argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
