import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const read = (name) =>
  readFile(new URL(`../ops/${name}`, import.meta.url), "utf8");

describe("Hermes production units", () => {
  it("keeps the dashboard loopback-only and resource bounded", async () => {
    const unit = await read("hermes-dashboard.service");

    assert.match(unit, /--host 127\.0\.0\.1/);
    assert.match(unit, /--port 9119/);
    assert.match(unit, /^User=bob$/m);
    assert.match(unit, /^MemoryMax=1G$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
  });

  it("caps the gateway without replacing the upstream-generated unit", async () => {
    const dropIn = await read("hermes-gateway-memory.conf");

    assert.equal(dropIn, "[Service]\nMemoryMax=2G\n");
  });

  it("runs persistent nightly backups", async () => {
    const service = await read("hermes-backup.service");
    const timer = await read("hermes-backup.timer");

    assert.match(service, /^User=bob$/m);
    assert.match(service, /^MemoryMax=512M$/m);
    assert.match(timer, /^Persistent=true$/m);
    assert.match(timer, /^OnCalendar=.*03:17:00 UTC$/m);
  });
});

describe("Hermes backup transport", () => {
  it("pins the SSH host key and enforces local and remote retention", async () => {
    const script = await read("hermes-backup.sh");

    assert.match(script, /StrictHostKeyChecking=yes/);
    assert.match(script, /UserKnownHostsFile=/);
    assert.match(script, /-mtime \+7 -delete/);
    assert.match(script, /-mtime \+30 -delete/);
    assert.doesNotMatch(script, /StrictHostKeyChecking=no/);
  });
});

describe("Hermes dashboard ingress", () => {
  it("authenticates Bob sessions before proxying to the loopback dashboard", async () => {
    const nginx = await read("nginx-hermes-location.conf");

    assert.match(nginx, /location = \/_bob_hermes_auth \{/);
    assert.match(nginx, /^\s*internal;$/m);
    assert.match(
      nginx,
      /proxy_pass https:\/\/bob\.blder\.bot\/api\/trpc\/workspace\.list\?input=/,
    );
    assert.match(nginx, /^\s*proxy_set_header Cookie \$http_cookie;$/m);
    assert.match(nginx, /location \/hermes\/ \{/);
    assert.match(nginx, /^\s*auth_request \/_bob_hermes_auth;$/m);
    assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:9119\/;/);
    assert.match(nginx, /^\s*proxy_set_header X-Forwarded-Prefix \/hermes;$/m);
    assert.doesNotMatch(nginx, /proxy_pass http:\/\/0\.0\.0\.0/);
    assert.doesNotMatch(nginx, /^\s*listen /m);
  });
});

describe("Hermes Obsidian loop", () => {
  it("syncs the canonical vault without overwriting a dirty checkout", async () => {
    const script = await read("hermes-vault-sync.sh");
    const service = await read("hermes-vault-sync.service");
    const timer = await read("hermes-vault-sync.timer");

    assert.match(script, /git status --porcelain/);
    assert.match(script, /git pull --ff-only origin master/);
    assert.match(script, /git push origin master/);
    assert.doesNotMatch(script, /reset --hard|clean -f/);
    assert.match(service, /^User=bob$/m);
    assert.match(service, /^RuntimeDirectory=hermes-vault-sync$/m);
    assert.match(service, /^ProtectSystem=strict$/m);
    assert.match(timer, /^OnUnitActiveSec=10min$/m);
  });

  it("alerts when the daily note misses its cutoff", async () => {
    const script = await read("hermes-daily-canary.sh");
    const timer = await read("hermes-daily-canary.timer");

    assert.match(script, /Daily\/\$\{today\}\.md/);
    assert.match(script, /systemd-cat/);
    assert.match(timer, /^OnCalendar=.*15:30:00 UTC$/m);
  });
});
