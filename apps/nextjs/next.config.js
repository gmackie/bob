import { withSentryConfig } from "@sentry/nextjs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const { integrations } = /** @type {{ integrations: import("@bob/config").integrations }} */ (await jiti.import("@bob/config"));
await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,

  transpilePackages: [
    "@bob/api",
    "@bob/auth",
    "@bob/config",
    "@bob/db",
    "@bob/monitoring",
    "@bob/ui",
    "@bob/validators",
  ],

  typescript: { ignoreBuildErrors: true },
};

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: true,
};

export default integrations.sentry
  ? withSentryConfig(config, sentryConfig)
  : config;
