#!/usr/bin/env python3
"""Run Bob's guarded migration using the deployment node's scoped broker."""
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request

APP_ID = "d717c640-dcf3-4c4e-88a1-01e287aa3029"
STAGE_ID = "a100ec84-51a1-4213-9c70-1559291587cc"


def migrate_production():
    config = json.loads(Path("/etc/forgegraph/agent.json").read_text())
    server = config["server_url"]
    token = config["token"]
    if not isinstance(server, str) or not isinstance(token, str) or not token:
        raise ValueError("Invalid agent configuration")
    if urllib.parse.urlparse(server).scheme != "https":
        raise ValueError("Secret broker requires HTTPS")
    query = urllib.parse.urlencode({"appId": APP_ID, "stageId": STAGE_ID})
    request = urllib.request.Request(
        server.rstrip("/") + "/api/agent/secrets?" + query,
        headers={"Authorization": "Bearer " + token, "User-Agent": "forge/0.1.71"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    secrets = body["secrets"]
    database_url = secrets["DATABASE_URL_LOCAL"]
    if not isinstance(database_url, str) or not database_url:
        raise ValueError("Missing direct production database URL")
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    subprocess.run(
        ["pnpm", "-F", "@bob/db", "migrate:production"],
        cwd=Path(__file__).resolve().parent.parent,
        env=environment,
        check=True,
    )


if __name__ == "__main__":
    try:
        migrate_production()
    except Exception:
        # Broker/driver exceptions can contain credentials; no response body or
        # environment values are printed or written to the deployment checkout.
        print("Guarded production migration failed; worker upload must stop", file=sys.stderr)
        sys.exit(1)
