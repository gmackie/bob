#!/usr/bin/env python3
"""Loud Hermes health check: alert a human when scheduled Hermes work is broken.

BOB-108. From 2026-10-13 to 2026-11-21 the morning briefing and nightly wrap-up
failed every day with "HTTP 400: The 'gpt-5.4' model is not supported", and the
only signal was a journal line from a failed unit nobody was watching. This check
replaces that canary. It reads Hermes's cron state (read-only) and today's daily
note, and when anything is wrong it:

  * logs each problem to the journal at alert priority,
  * sends one Telegram alert through the hermes-operator profile (the same
    no-LLM delivery path the operator briefs use, so a rejected model cannot
    silence it), and
  * exits non-zero (1 = problems found and alerted, 2 = the alert itself failed).

Problems detected:
  * any enabled job whose last run failed (classified "model rejected" when the
    provider refused the configured model),
  * the morning briefing job missing, paused, or not run for over a day,
  * today's Daily/YYYY-MM-DD.md note (America/Los_Angeles) missing.

Stdlib only; runs with /usr/bin/python3 from hermes-daily-canary.service.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

OPERATOR_PROFILE = "hermes-operator"
BRIEFING_JOB = "Morning briefing"
BRIEFING_MAX_AGE = timedelta(hours=26)
VAULT_TZ = ZoneInfo("America/Los_Angeles")
SEND_TIMEOUT_SECONDS = 120
ERROR_SNIPPET_CHARS = 240
MAX_ALERT_CHARS = 1800
CONFIG_HINT = (
    "Config is versioned in bob apps/hermes-shepherd/hermes-config; "
    "fix it there and run apps/hermes-shepherd/ops/install-hermes-config.sh."
)

_MODEL_REJECTION = re.compile(
    r"model_not_found"
    r"|\b(unknown|invalid|unsupported) model\b"
    r"|\bmodel\b.{0,120}?\b(is not supported|not supported|unsupported|not found|"
    r"does not exist|not available|deprecated|retired|no longer available)\b",
    re.IGNORECASE | re.DOTALL,
)

_PRIORITY_PREFIX = {"alert": "<1>", "err": "<3>", "warning": "<4>", "info": "<6>"}


def is_model_rejection(error: object) -> bool:
    return bool(_MODEL_REJECTION.search(str(error or "")))


def _snippet(value: object) -> str:
    text = " ".join(str(value or "").split())
    if len(text) > ERROR_SNIPPET_CHARS:
        return text[: ERROR_SNIPPET_CHARS - 1] + "…"
    return text


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _enabled(job: dict[str, Any]) -> bool:
    return not (
        job.get("enabled") is False
        or job.get("paused") is True
        or job.get("state") == "paused"
    )


def find_problems(
    jobs: Iterable[dict[str, Any]],
    *,
    now: datetime,
    note_present: bool,
    note_name: str,
) -> list[str]:
    problems: list[str] = []
    jobs = [job for job in jobs if isinstance(job, dict)]

    for job in jobs:
        if not _enabled(job) or job.get("last_status") != "error":
            continue
        name = job.get("name") or job.get("id") or "unnamed job"
        error = job.get("last_error")
        streak = job.get("failure_streak")
        streak_note = f" ({streak} runs in a row)" if isinstance(streak, int) and streak > 1 else ""
        if is_model_rejection(error):
            model = job.get("model") or "the default model"
            provider = job.get("provider") or "default provider"
            problems.append(
                f"{name}: model rejected{streak_note} — configured {model} via {provider}: {_snippet(error)}"
            )
        else:
            problems.append(f"{name}: last run failed{streak_note}: {_snippet(error)}")

    briefing = [job for job in jobs if job.get("name") == BRIEFING_JOB]
    if not briefing:
        problems.append(f"{BRIEFING_JOB}: job is missing from Hermes cron")
    elif not any(_enabled(job) for job in briefing):
        problems.append(f"{BRIEFING_JOB}: job is paused or disabled")
    else:
        last_runs = [_parse_time(job.get("last_run_at")) for job in briefing if _enabled(job)]
        last_run = max((t for t in last_runs if t is not None), default=None)
        if last_run is None or now - last_run > BRIEFING_MAX_AGE:
            when = last_run.isoformat() if last_run else "never"
            problems.append(f"{BRIEFING_JOB}: has not run in over a day (last run {when})")

    if not note_present:
        problems.append(f"Daily briefing note missing after cutoff: {note_name}")
    return problems


def _load_jobs(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    jobs = data.get("jobs") if isinstance(data, dict) else data
    if not isinstance(jobs, list):
        raise ValueError("no jobs list")
    return jobs


def _journal(priority: str, message: str) -> None:
    # systemd parses <N> prefixes on unit stdout (SyslogLevelPrefix=yes).
    print(f"{_PRIORITY_PREFIX.get(priority, '<6>')}hermes-health-check: {message}", flush=True)


def _hermes_binary(hermes_home: Path) -> str:
    return os.environ.get("HERMES_HEALTH_SEND_BINARY") or str(
        Path(os.environ.get("HOME", str(hermes_home.parent))) / ".local" / "bin" / "hermes"
    )


def _telegram_sender(hermes_home: Path) -> Callable[[str], None]:
    def send(body: str) -> None:
        subprocess.run(
            [_hermes_binary(hermes_home), "-p", OPERATOR_PROFILE, "send", "-t", "telegram", "-q"],
            input=body.encode("utf-8"),
            check=True,
            timeout=SEND_TIMEOUT_SECONDS,
            stdout=subprocess.DEVNULL,
            stderr=sys.stderr,
        )

    return send


def format_alert(problems: list[str], *, host: str, label: str | None) -> str:
    prefix = f"[{label}] " if label else ""
    lines = [f"{prefix}🚨 Hermes alert on {host}: {len(problems)} problem(s)"]
    lines += [f"• {problem}" for problem in problems]
    lines.append(CONFIG_HINT)
    body = "\n".join(lines)
    if len(body) > MAX_ALERT_CHARS:
        body = body[: MAX_ALERT_CHARS - 1] + "…"
    return body


def main(
    argv: list[str] | None = None,
    *,
    now: datetime | None = None,
    send: Callable[[str], None] | None = None,
    log: Callable[[str, str], None] = _journal,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hermes-home", default=os.environ.get("HERMES_HOME", "/home/bob/.hermes"))
    parser.add_argument(
        "--vault",
        default=os.environ.get("HERMES_VAULT_PATH", "/home/bob/hermes-workspace/obsidian"),
    )
    parser.add_argument("--jobs-file", help="read job state from this file instead of HERMES_HOME/cron/jobs.json")
    parser.add_argument("--label", help="prefix the alert, e.g. TEST for a controlled drill")
    parser.add_argument("--dry-run", action="store_true", help="report problems without sending an alert")
    args = parser.parse_args(argv)

    now = now or datetime.now(timezone.utc)
    hermes_home = Path(args.hermes_home)
    jobs_path = Path(args.jobs_file) if args.jobs_file else hermes_home / "cron" / "jobs.json"
    today = now.astimezone(VAULT_TZ).date().isoformat()
    note_name = f"Daily/{today}.md"
    note = Path(args.vault) / note_name
    try:
        note_present = note.is_file() and note.stat().st_size > 0
    except OSError:
        note_present = False

    try:
        jobs = _load_jobs(jobs_path)
    except (OSError, ValueError) as exc:
        problems = [f"cannot read Hermes cron state {jobs_path.name}: {_snippet(exc)}"]
        if not note_present:
            problems.append(f"Daily briefing note missing after cutoff: {note_name}")
    else:
        problems = find_problems(jobs, now=now, note_present=note_present, note_name=note_name)

    if not problems:
        log("info", f"ok: jobs healthy and {note_name} present")
        return 0

    for problem in problems:
        log("alert", problem)
    body = format_alert(problems, host=os.uname().nodename, label=args.label)
    if args.dry_run:
        log("warning", "dry run: alert not sent")
        return 1
    try:
        (send or _telegram_sender(hermes_home))(body)
    except Exception as exc:  # noqa: BLE001 - any delivery failure must be loud
        log("alert", f"alert delivery failed ({type(exc).__name__}); problems above are unreported")
        return 2
    log("warning", f"alert sent via {OPERATOR_PROFILE} telegram ({len(problems)} problem(s))")
    return 1


if __name__ == "__main__":
    sys.exit(main())
