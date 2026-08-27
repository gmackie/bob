#!/usr/bin/env python3
"""No-agent cron wrapper: assemble one operator brief, deliver it through the hermes-operator profile.

The default Hermes profile no longer owns a Telegram connection, so the scheduler's own
`deliver: telegram` path cannot reach the platform. This wrapper runs the fixed job module
and hands its output to the profile-scoped sender, which holds the operator profile's
credentials. A send failure fails the run so cron history and the daily canary see it.
Installed twice (morning/close); the installed filename selects the underlying job.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

SOURCE_BY_FILENAME = {
    "hermes-operator-morning-send.py": "hermes-operator-today.py",
    "hermes-operator-close-send.py": "hermes-operator-close.py",
}
PROFILE = "hermes-operator"
SEND_TIMEOUT_SECONDS = 120


def _hermes_binary() -> str:
    return os.environ.get("HERMES_OPERATOR_SEND_BINARY") or str(Path.home() / ".local" / "bin" / "hermes")


def _load_job_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("hermes_operator_job", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("operator job module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_wrapper(entrypoint: str, *, load_job=None, send=None, emit=print) -> None:
    source = SOURCE_BY_FILENAME.get(Path(entrypoint).name)
    if source is None:
        raise RuntimeError("Unknown Hermes operator send entrypoint")
    hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    module = (load_job or _load_job_module)(hermes_home / "scripts" / source)
    lines: list[str] = []
    module.run_job(source, emit=lines.append)
    body = "\n".join(lines).strip()
    if not body:
        return
    (send or _send)(body)
    emit(body)


def _send(body: str) -> None:
    subprocess.run(
        [_hermes_binary(), "-p", PROFILE, "send", "-t", "telegram"],
        input=body.encode("utf-8"),
        check=True,
        timeout=SEND_TIMEOUT_SECONDS,
        stdout=subprocess.DEVNULL,
        stderr=sys.stderr,
    )


if __name__ == "__main__":
    run_wrapper(__file__)
