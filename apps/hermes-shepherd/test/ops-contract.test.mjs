import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../ops/nginx-hermes-location.conf", import.meta.url);
const reconcileServiceUrl = new URL(
  "../ops/hermes-operator-reconcile.service",
  import.meta.url,
);
const reconcileTimerUrl = new URL(
  "../ops/hermes-operator-reconcile.timer",
  import.meta.url,
);
const installUrl = new URL(
  "../ops/install-hermes-operator.sh",
  import.meta.url,
);

test("Hermes remains loopback-only behind Bob session or service auth", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.match(config, /auth_request \/_bob_hermes_auth;/);
  assert.match(config, /bob\.blder\.bot\/api\/internal\/hermes-origin-auth/);
  assert.match(config, /proxy_set_header Authorization \$http_authorization;/);
  assert.match(config, /proxy_set_header Cookie \$http_cookie;/);
  assert.match(config, /proxy_set_header X-Hermes-Auth-Uri \$request_uri;/);
  assert.match(
    config,
    /proxy_set_header X-Hermes-Auth-Method \$request_method;/,
  );
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:9119\//);
  assert.match(config, /proxy_set_header Authorization "";/);
  assert.match(config, /proxy_set_header Cookie "";/);
  assert.doesNotMatch(config, /Bearer\s+[A-Za-z0-9_-]{8,}/);
});

test("Hermes operator jobs are reconciled after boot and periodically", async () => {
  const [service, timer] = await Promise.all([
    readFile(reconcileServiceUrl, "utf8"),
    readFile(reconcileTimerUrl, "utf8"),
  ]);

  assert.match(service, /^User=bob$/m);
  assert.match(service, /^After=hermes-gateway\.service$/m);
  assert.match(service, /^Environment=HOME=\/home\/bob$/m);
  assert.match(service, /^Environment=HERMES_HOME=\/home\/bob\/\.hermes$/m);
  assert.match(
    service,
    /^Environment=PYTHONPATH=\/home\/bob\/\.hermes\/hermes-agent$/m,
  );
  assert.match(
    service,
    /^ExecStart=\/home\/bob\/\.hermes\/hermes-agent\/venv\/bin\/python \/home\/bob\/\.hermes\/plugins\/hermes-operator\/reconcile-hermes-operator\.py$/m,
  );
  assert.doesNotMatch(service, /API_KEY|Bearer\s+[A-Za-z0-9_-]{8,}/);

  assert.match(timer, /^OnBootSec=2min$/m);
  assert.match(timer, /^OnUnitActiveSec=5min$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
});

test("Hermes operator install validates secrets and refuses tool overrides", async () => {
  const script = await readFile(installUrl, "utf8");

  assert.match(script, /HERMES_BOB_OPERATOR_URL/);
  assert.match(script, /HERMES_BOB_OPERATOR_API_KEY/);
  assert.match(script, /plugins doctor hermes-operator --ci/);
  assert.match(
    script,
    /plugins enable hermes-operator --no-allow-tool-override/,
  );
  assert.match(script, /hermes-operator-send\.py"\s+\\\n\s+"\$\{SCRIPTS_DIR\}\/hermes-operator-morning-send\.py"/);
  assert.match(script, /hermes-operator-send\.py"\s+\\\n\s+"\$\{SCRIPTS_DIR\}\/hermes-operator-close-send\.py"/);
  assert.match(script, /HERMES_OPERATOR_USAGE_JOURNAL=\/home\/bob\/\.local\/state\/skillfleet-workflows\/bob\.jsonl/);
  assert.match(script, /systemctl restart hermes-gateway\.service/);
  assert.match(
    script,
    /systemctl enable --now hermes-operator-reconcile\.timer/,
  );
  assert.doesNotMatch(script, /Bearer\s+[A-Za-z0-9_-]{8,}/);
});

// --- Production units shepherded onto hetzner-bob -------------------------
// Ported from feat/hermes-shepherd. The nginx case from that branch is not
// carried over: it asserted the older workspace.list auth subrequest, and the
// config here uses the dedicated hermes-origin-auth endpoint and additionally
// strips Bob credentials — covered by the loopback-only test above.
const readOps = (name) =>
  readFile(new URL(`../ops/${name}`, import.meta.url), "utf8");

test("Hermes dashboard stays loopback-only and resource bounded", async () => {
  const unit = await readOps("hermes-dashboard.service");
  assert.match(unit, /--host 127\.0\.0\.1/);
  assert.match(unit, /--port 9119/);
  assert.match(unit, /^User=bob$/m);
  assert.match(unit, /^MemoryMax=1G$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
});

test("Hermes gateway is capped by a drop-in, not a replacement unit", async () => {
  assert.equal(await readOps("hermes-gateway-memory.conf"), "[Service]\nMemoryMax=2G\n");
});

test("Hermes backups run nightly and survive downtime", async () => {
  const service = await readOps("hermes-backup.service");
  const timer = await readOps("hermes-backup.timer");
  assert.match(service, /^User=bob$/m);
  assert.match(service, /^MemoryMax=512M$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^OnCalendar=.*03:17:00 UTC$/m);
});

test("Hermes backup transport pins the host key and prunes both ends", async () => {
  const script = await readOps("hermes-backup.sh");
  assert.match(script, /StrictHostKeyChecking=yes/);
  assert.match(script, /UserKnownHostsFile=/);
  assert.match(script, /-mtime \+7 -delete/);
  assert.match(script, /-mtime \+30 -delete/);
  assert.doesNotMatch(script, /StrictHostKeyChecking=no/);
});

test("Hermes vault sync never overwrites a dirty checkout", async () => {
  const script = await readOps("hermes-vault-sync.sh");
  const service = await readOps("hermes-vault-sync.service");
  const timer = await readOps("hermes-vault-sync.timer");
  assert.match(script, /git status --porcelain/);
  assert.match(script, /git pull --ff-only origin master/);
  assert.match(script, /git push origin master/);
  assert.doesNotMatch(script, /reset --hard|clean -f/);
  assert.match(service, /^User=bob$/m);
  assert.match(service, /^RuntimeDirectory=hermes-vault-sync$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.match(timer, /^OnUnitActiveSec=10min$/m);
});

// --- BOB-108: versioned Hermes config + loud failure detection -------------
const readConfig = (name) =>
  readFile(new URL(`../hermes-config/${name}`, import.meta.url), "utf8");
const HERMES_CONFIGS = [
  "config.yaml",
  "profiles/hermes-console/config.yaml",
  "profiles/hermes-operator/config.yaml",
];
// Model ids retired for Codex ChatGPT accounts (BOB-105). Never ship them again.
const RETIRED_MODELS = ["gpt-5.4", "gpt-5.4-mini"];

test("Hermes daily canary runs the health check after both scheduled jobs", async () => {
  const service = await readOps("hermes-daily-canary.service");
  const timer = await readOps("hermes-daily-canary.timer");
  assert.match(
    service,
    /^ExecStart=\/usr\/bin\/python3 \/opt\/bob\/ops\/hermes-health-check\.py$/m,
  );
  assert.match(service, /^User=bob$/m);
  assert.match(service, /^Environment=HERMES_HOME=\/home\/bob\/\.hermes$/m);
  // The Telegram alert path writes Hermes logs; the rest of $HOME stays read-only.
  assert.match(service, /^ProtectHome=read-only$/m);
  assert.match(service, /^ReadWritePaths=\/home\/bob\/\.hermes$/m);
  // Morning briefing 07:00 and nightly wrap-up 22:00 America/Los_Angeles.
  assert.match(timer, /^OnCalendar=.*15:30:00 UTC$/m);
  assert.match(timer, /^OnCalendar=.*06:30:00 UTC$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test("Hermes health check alerts through the operator Telegram path", async () => {
  const script = await readOps("hermes-health-check.py");
  assert.match(script, /"-p", OPERATOR_PROFILE, "send", "-t", "telegram"/);
  assert.match(script, /OPERATOR_PROFILE = "hermes-operator"/);
  assert.match(script, /Daily/);
});

test("versioned Hermes configs carry no secrets", async () => {
  for (const name of HERMES_CONFIGS) {
    const config = await readConfig(name);
    assert.doesNotMatch(
      config,
      /^\s*[\w-]*(api_?key|token|secret|password)[\w-]*:\s*["']?[^\s"'#{$][^\s"']{7,}/im,
      name,
    );
    assert.doesNotMatch(config, /Bearer\s+[A-Za-z0-9_-]{8,}/, name);
    assert.doesNotMatch(config, /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-)/, name);
  }
});

test("versioned Hermes configs pin supported models and the jobs follow them", async () => {
  const pins = JSON.parse(await readConfig("job-models.json"));
  for (const name of HERMES_CONFIGS) {
    const config = await readConfig(name);
    const model = config.match(/^model:\n  default: (\S+)\n  provider: (\S+)\n/);
    assert.ok(model, `${name} has a top-level model.default/provider`);
    const compression = config.match(/^auxiliary:\n  compression:\n    provider: (\S+)\n    model: (\S+)\n/m);
    assert.ok(compression, `${name} pins the compression model`);
    for (const retired of RETIRED_MODELS) {
      assert.notEqual(model[1], retired, name);
      assert.notEqual(compression[2], retired, name);
    }
    if (name === "config.yaml") {
      assert.ok(pins.jobs.length >= 2);
      for (const job of pins.jobs) {
        assert.equal(job.model, model[1], `${job.name} follows model.default`);
        assert.equal(job.provider, model[2], `${job.name} follows model.provider`);
      }
    }
  }
  assert.deepEqual(
    pins.jobs.map((job) => job.name).sort(),
    ["Morning briefing", "Nightly vault wrap-up"],
  );
});

test("Hermes config install backs up, keeps 0600, and has a read-only check", async () => {
  const script = await readOps("install-hermes-config.sh");
  assert.match(script, /--check/);
  assert.match(script, /\.bak-\$\{STAMP\}/);
  assert.match(script, /install -o bob -g bob -m 0600/);
  for (const name of HERMES_CONFIGS) {
    assert.ok(script.includes(name.replace("config.yaml", "")), name);
  }
  assert.match(script, /apply-hermes-job-models\.py/);
  assert.match(script, /hermes-health-check\.py/);
  assert.match(script, /systemctl enable --now hermes-daily-canary\.timer/);
  // Only a changed config restarts the gateway; never unrelated bob services.
  assert.match(script, /if \[\[ "\$\{changed\}" -eq 1 \]\]; then\n\s+systemctl restart hermes-gateway\.service/);
  assert.doesNotMatch(script, /ooda-runner|bob-ws-gateway|bob-execution/);
});
