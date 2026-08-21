import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../ops/nginx-hermes-location.conf", import.meta.url);

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
