import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const eas = JSON.parse(readFileSync(new URL("../apps/mobile-bob/eas.json", import.meta.url), "utf8"));
const configPath = require.resolve("../apps/mobile-bob/app.config.js");

test("hosted simulator keeps the development build and resolves hosted services", () => {
  const profile = eas.build["development-hosted-simulator"];
  assert.equal(profile.extends, "development");
  assert.deepEqual(Object.keys(profile).sort(), ["env", "extends"]);
  const development = eas.build.development;
  assert.equal(development.developmentClient, true);
  assert.equal(development.ios.simulator, true);
  assert.equal(development.distribution, "internal");
  assert.equal(development.env.API_URL, "http://localhost:3000");

  const original = process.env;
  try {
    process.env = { APP_VARIANT: "development", ...development.env, ...profile.env };
    delete require.cache[configPath];
    const config = require(configPath)({ config: {} });
    assert.equal(config.ios.bundleIdentifier, "com.gmacko.bob.dev");
    assert.equal(config.android.package, "com.gmacko.bob.dev");
    assert.equal(config.extra.API_URL, "https://bob.blder.bot");
    assert.equal(config.extra.AUTH_URL, "https://bob.blder.bot");
    assert.equal(config.extra.OODA_API_URL, "https://ooda.blder.bot");
    assert.equal(config.extra.GATEWAY_PUBLIC_URL, "wss://ws.blder.bot");
  } finally {
    process.env = original;
    delete require.cache[configPath];
  }
});
