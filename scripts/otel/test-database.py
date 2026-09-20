#!/usr/bin/env python3
"""Run Bob's trace graph contract against an owned disposable PostgreSQL cluster."""
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import tempfile


def postgres_bin():
    configured = os.environ.get("PG_BIN")
    candidates = [Path(configured)] if configured else []
    if shutil.which("pg_config"):
        candidates.append(Path(subprocess.check_output(["pg_config", "--bindir"], text=True).strip()))
    for root in (Path("/usr/lib/postgresql"), Path("/opt/homebrew/opt")):
        candidates.extend(root.glob("*/bin"))
    for candidate in candidates:
        if (candidate / "initdb").exists():
            return candidate
    raise SystemExit("PostgreSQL initdb/pg_ctl required; set PG_BIN to its bin directory")


pg = postgres_bin()
with tempfile.TemporaryDirectory(prefix="bob-observability-") as tmp:
    prefix = []
    if os.geteuid() == 0:
        owner = pwd.getpwnam("postgres")
        os.chown(tmp, owner.pw_uid, owner.pw_gid)
        prefix = ["runuser", "-u", "postgres", "--"]
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    data = str(Path(tmp) / "data")
    def run(tool, *args):
        subprocess.run([*prefix, str(pg / tool), *args], check=True, stdout=subprocess.DEVNULL)
    run("initdb", "-D", data, "-A", "trust", "-U", "bob_test", "--no-locale")
    run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"), "-o", f"-h 127.0.0.1 -p {port} -k {tmp}", "-w", "start")
    try:
        run("createdb", "-h", "127.0.0.1", "-p", str(port), "-U", "bob_test", "bob_test")
        result = subprocess.run([
            "pnpm", "--filter", "@gmacko/core", "exec", "vitest", "run",
            "src/telemetry/database.observability.test.ts",
        ], env=dict(os.environ, DATABASE_URL_TEST=f"postgres://bob_test@127.0.0.1:{port}/bob_test"))
    finally:
        run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
    raise SystemExit(result.returncode)
