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
  assert.match(script, /systemctl restart hermes-gateway\.service/);
  assert.match(
    script,
    /systemctl enable --now hermes-operator-reconcile\.timer/,
  );
  assert.doesNotMatch(script, /Bearer\s+[A-Za-z0-9_-]{8,}/);
});
