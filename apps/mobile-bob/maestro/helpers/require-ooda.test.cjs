const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const script = readFileSync(join(__dirname, "require-ooda.js"), "utf8");
function run(overrides = {}, respond = () => ({ status: 200, body: JSON.stringify({
  capabilities: { conversation_read: true, conversation_write: true }, items: [],
}) })) {
  const calls = [];
  runInNewContext(script, {
    OODA_API_URL: "http://localhost:3001/",
    OODA_AUTH_COOKIE: "review-cookie",
    OODA_AUTH_TOKEN: "",
    ...overrides,
    http: { get(url, options) { calls.push({ url, options }); return respond(url); } },
  });
  return calls;
}

test("checks rollout and authenticated conversation access", () => {
  const calls = run();
  assert.equal(calls[0].url, "http://localhost:3001/api/v1/rollout");
  assert.equal(calls[1].url, "http://localhost:3001/api/v1/conversations?status=active&limit=1");
  assert.equal(calls[1].options.headers.Cookie, "review-cookie");
});
test("supports the development bearer credential", () => {
  const calls = run({ OODA_AUTH_COOKIE: "", OODA_AUTH_TOKEN: "dev-token" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer dev-token");
  assert.equal(calls[0].options.headers.Cookie, undefined);
});
test("requires an explicit endpoint", () => {
  assert.throws(() => run({ OODA_API_URL: "" }), /Set OODA_API_URL/);
});
test("reports an unreachable gateway without leaking error details", () => {
  assert.throws(() => run({}, () => { throw new Error("secret"); }), (error) =>
    /gateway unreachable/.test(error.message) && !error.message.includes("secret"));
});
for (const status of [401, 403, 500]) {
  test(`rejects HTTP ${status} without exposing the response body`, () => {
    assert.throws(() => run({}, () => ({ status, body: "secret" })), (error) =>
      error.message.includes(`HTTP ${status}`) && !error.message.includes("secret"));
  });
}
test("rejects a non-JSON endpoint", () => {
  assert.throws(() => run({}, () => ({ status: 200, body: "<html>" })), /did not return JSON/);
});
for (const capability of ["conversation_read", "conversation_write"]) {
  test(`requires ${capability}`, () => {
    assert.throws(() => run({}, () => ({ status: 200, body: JSON.stringify({
      capabilities: { conversation_read: true, conversation_write: true, [capability]: false },
    }) })), /needs conversation_read and conversation_write/);
  });
}
test("checks conversation access even when rollout succeeds", () => {
  assert.throws(() => run({}, (url) => ({ status: 200, body: JSON.stringify(
    url.includes("rollout") ? { capabilities: { conversation_read: true, conversation_write: true } } : {},
  ) })), /invalid conversation list/);
});
