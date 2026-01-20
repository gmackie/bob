import { defineConfig, devices } from "@playwright/test";

import { execSync } from "node:child_process";

function isPortInUse(port: number): boolean {
  // Best-effort check for local dev. On CI we keep the default port.
  // Note: `lsof` may not exist on all platforms.
  if (process.platform === "win32") return false;

  try {
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function pickPort(preferredPort: number): number {
  if (process.env.CI) return preferredPort;

  if (!isPortInUse(preferredPort)) return preferredPort;

  // Try a small local range to avoid collisions with other Next apps.
  for (let port = preferredPort + 1; port <= preferredPort + 50; port++) {
    if (!isPortInUse(port)) return port;
  }

  // Fall back to the preferred port even if we think it's in use;
  // Playwright will surface a clear error in that case.
  return preferredPort;
}

const PORT_ENV_KEY = "BOB_E2E_PORT";

function readPortFromEnv(): number | null {
  const raw = process.env[PORT_ENV_KEY];
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

// Playwright loads the config in both the runner and worker processes.
// We must choose the port exactly once to keep `use.baseURL` and `webServer.url`
// consistent across processes.
const port = readPortFromEnv() ?? pickPort(3000);
process.env[PORT_ENV_KEY] = String(port);
// Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) resolution issues
// when Next binds only on IPv4.
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 12"] },
    },
  ],

  webServer: {
    command: `pnpm with-env next dev -H 127.0.0.1 -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
