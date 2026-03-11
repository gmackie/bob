import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

if (typeof process.loadEnvFile === "function") {
  const candidateFiles = [
    path.resolve(__dirname, "..", "..", ".env.staging"),
    path.resolve(__dirname, "..", "..", ".env.beta"),
    path.resolve(__dirname, "..", "..", ".env.beta.local"),
  ];

  for (const file of candidateFiles) {
    if (!fs.existsSync(file)) {
      continue;
    }

    if (!process.env.DATABASE_URL) {
      process.loadEnvFile(file);
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "BETA Playwright config requires DATABASE_URL. Export DATABASE_URL from the beta database secret before running test:e2e:beta*."
  );
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://beta.tasks.gmac.io";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: "line",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
