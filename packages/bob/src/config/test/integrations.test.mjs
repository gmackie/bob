import assert from "node:assert/strict";
import { test } from "node:test";

import * as config from "../src/integrations.ts";

const stripe = {
  BOB_STRIPE_ENABLED: "true",
  STRIPE_SECRET_KEY: "rk_test_fixtureOnly",
  STRIPE_WEBHOOK_SECRET: "whsec_fixtureOnly",
  STRIPE_PRICE_PREMIUM: "price_fixturePremium",
  STRIPE_PRICE_PRO: "price_fixturePro",
};

test("absent, disabled, incomplete, malformed and complete runtime configuration", () => {
  const absent = config.resolveIntegrationConfig({});
  assert.equal(absent.sentry.status, "not_configured");
  assert.equal(absent.posthog.status, "not_configured");
  assert.equal(absent.realtime.status, "not_configured");
  assert.equal(absent.stripe.status, "disabled");

  assert.equal(config.resolveIntegrationConfig(stripe).stripe.enabled, true);
  assert.equal(
    config.resolveIntegrationConfig({ ...stripe, BOB_STRIPE_ENABLED: "false" })
      .stripe.status,
    "disabled",
  );
  assert.equal(
    config.resolveIntegrationConfig({ ...stripe, STRIPE_WEBHOOK_SECRET: " " })
      .stripe.status,
    "incomplete",
  );
  const invalid = config.resolveIntegrationConfig({
    ...stripe,
    STRIPE_SECRET_KEY: "private malformed fixture",
  }).stripe;
  assert.equal(invalid.status, "invalid");
  assert.match(invalid.reason, /STRIPE_SECRET_KEY/);
  assert.equal(
    JSON.stringify(invalid).includes("private malformed fixture"),
    false,
  );
});

test("billing remains opt-in even when all credentials are valid", () => {
  const { BOB_STRIPE_ENABLED: _enabled, ...credentials } = stripe;
  assert.equal(
    config.resolveIntegrationConfig(credentials).stripe.enabled,
    false,
  );
  assert.equal(
    config.resolveIntegrationConfig({ ...stripe, BOB_STRIPE_ENABLED: "yes" })
      .stripe.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      ...stripe,
      STRIPE_PRICE_PRO: stripe.STRIPE_PRICE_PREMIUM,
    }).stripe.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({ ...stripe, STRIPE_PRICE_PRO: "" }).stripe
      .enabled,
    true,
  );
  assert.equal(
    config.resolveIntegrationConfig({
      ...stripe,
      STRIPE_PRICE_PRO: "",
      STRIPE_PRICE_PREMIUM: "",
    }).stripe.status,
    "incomplete",
  );
});

test("observability and gateway configuration reject malformed values without throwing", () => {
  const valid = config.resolveIntegrationConfig({
    SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
    POSTHOG_KEY: "phc_fixtureOnly",
    GATEWAY_URL: "https://gateway.example",
  });
  assert.equal(valid.sentry.enabled, true);
  assert.equal(valid.posthog.enabled, true);
  assert.equal(valid.realtime.enabled, true);

  for (const env of [
    { SENTRY_DSN: "malformed-private-fixture" },
    { SENTRY_DSN: "https://sentry.example/1" },
    { SENTRY_DSN: "https://private%20key@sentry.example/1" },
    { SENTRY_DSN: 42 },
  ])
    assert.equal(config.resolveIntegrationConfig(env).sentry.status, "invalid");

  assert.equal(
    config.resolveIntegrationConfig({
      POSTHOG_HOST: "https://analytics.example",
    }).posthog.status,
    "incomplete",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      POSTHOG_KEY: "phc_fixtureOnly",
      POSTHOG_HOST: "javascript:private-fixture",
    }).posthog.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      GATEWAY_URL: "https://private:secret@gateway.example",
    }).realtime.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      GATEWAY_PUBLIC_URL: "wss://gateway.example",
    }).realtime.status,
    "incomplete",
  );
  assert.equal(
    config.resolveIntegrationConfig({ GATEWAY_URL: "wss://gateway.example" })
      .realtime.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      GATEWAY_URL: "https://gateway.example",
      GATEWAY_PUBLIC_URL: "malformed-private-fixture",
    }).realtime.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      GATEWAY_URL: "https://gate\nway.example",
    }).realtime.status,
    "invalid",
  );
});

test("public aliases follow server precedence and explicit disables", () => {
  assert.equal(
    config.resolveIntegrationConfig({
      NEXT_PUBLIC_SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
      EXPO_PUBLIC_POSTHOG_KEY: "phc_mobileFixture",
      GATEWAY_PUBLIC_URL: "wss://gateway.example",
    }).posthog.enabled,
    true,
  );
  assert.equal(
    config.resolveIntegrationConfig({
      SENTRY_DSN: "invalid-server-fixture",
      NEXT_PUBLIC_SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
    }).sentry.status,
    "invalid",
  );
  assert.equal(
    config.resolveIntegrationConfig({
      BOB_SENTRY_ENABLED: "0",
      SENTRY_DSN: "private-invalid-fixture",
    }).sentry.status,
    "disabled",
  );
});

test("startup metadata and legacy flags agree and never contain credentials", () => {
  const env = {
    ...stripe,
    SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
    GATEWAY_URL: "https://gateway.example",
    UNRELATED_SECRET: "never-export-this",
  };
  const statuses = config.initializeIntegrationConfig(env);
  assert.equal(config.getIntegrationStatuses(), statuses);
  assert.equal(config.integrations.stripe, true);
  assert.equal(config.isStripeEnabled(), true);
  assert.equal(config.integrations.sentry, config.isSentryEnabled());
  assert.equal(config.integrations.realtime.provider, "gateway");
  assert.equal(config.integrations.openapi, true);
  assert.equal(config.integrations.i18n, false);
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PREMIUM",
    "STRIPE_PRICE_PRO",
    "SENTRY_DSN",
    "GATEWAY_URL",
    "UNRELATED_SECRET",
  ])
    assert.equal(JSON.stringify(statuses).includes(env[key]), false);
  for (const id of ["revenuecat", "notifications", "email", "storage"]) {
    assert.equal(statuses[id].status, "unsupported");
    assert.equal(statuses[id].enabled, false);
    assert.ok(statuses[id].reason.length > 0);
  }
  config.initializeIntegrationConfig({});
  assert.equal(config.isStripeEnabled(), false);
  assert.equal(config.isSentryEnabled(), false);
});
