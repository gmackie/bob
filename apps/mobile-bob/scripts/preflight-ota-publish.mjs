#!/usr/bin/env node
// Publish a Bob OTA update through Preflight (BOB-113; EAS Update is gone).
//
//   node scripts/preflight-ota-publish.mjs --channel development|preview|production \
//     [--platform ios|android] [--message "..."] [--workspace-root <checkout>]
//
// Preflight queues ota.export + ota.publish on a runner. The runner exports the
// checkout at --workspace-root as it is, so commit first and point it at a clean
// checkout of the commit you mean to ship. Without --workspace-root, Preflight
// uses the app's last known checkout.
//
// The token comes from PREFLIGHT_TOKEN or ~/.config/preflight/config.json
// (`preflight login`). It is never printed.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const APP_ID = "pfapp_bob";
const CHANNELS = ["development", "preview", "production"];
const PLATFORMS = ["ios", "android"];

const { values } = parseArgs({
  options: {
    channel: { type: "string" },
    platform: { type: "string", default: "ios" },
    message: { type: "string" },
    "workspace-root": { type: "string" },
  },
});

if (!CHANNELS.includes(values.channel ?? "")) {
  console.error(`--channel must be one of ${CHANNELS.join(", ")}`);
  process.exit(2);
}
if (!PLATFORMS.includes(values.platform ?? "")) {
  console.error(`--platform must be one of ${PLATFORMS.join(", ")}`);
  process.exit(2);
}

function readConfig() {
  try {
    return JSON.parse(
      readFileSync(join(homedir(), ".config/preflight/config.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

const config = readConfig();
const token = process.env.PREFLIGHT_TOKEN ?? config.token;
if (!token) {
  console.error("No Preflight token: run `preflight login` or set PREFLIGHT_TOKEN.");
  process.exit(2);
}
const apiUrl = (
  process.env.PREFLIGHT_API_URL ??
  config.apiUrl ??
  "https://preflight.forgegraf.com"
).replace(/\/+$/, "");

// The runtime version is the literal in app.config.js; updates only reach
// binaries built with the same one.
const require = createRequire(import.meta.url);
const appConfig = require("../app.config.js")({ config: {} });
const runtimeVersion = appConfig.runtimeVersion;
if (typeof runtimeVersion !== "string") {
  console.error("app.config.js must set a literal runtimeVersion.");
  process.exit(2);
}

const body = {
  channel: values.channel,
  platform: values.platform,
  runtimeVersion,
  message:
    values.message ?? `Bob ${values.channel} ${new Date().toISOString()}`,
  ...(values["workspace-root"]
    ? { workspaceRoot: values["workspace-root"] }
    : {}),
};

const response = await fetch(`${apiUrl}/api/preflight/v1/apps/${APP_ID}/ota/publish`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "bob-ota-publish",
  },
  body: JSON.stringify(body),
});
const text = await response.text();
if (!response.ok) {
  console.error(`Preflight refused the publish (${response.status}): ${text}`);
  process.exit(1);
}
const { data } = JSON.parse(text);
console.log(
  `Queued ${values.platform} ${values.channel} update for runtime ${runtimeVersion}: workflow ${data.workflowId}`,
);
console.log(`Follow it: ${apiUrl}/api/preflight/v1/workflows/${data.workflowId}`);
