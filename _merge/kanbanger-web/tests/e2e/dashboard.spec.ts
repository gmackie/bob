import { test, expect } from "@playwright/test";
import {
  cleanupForgeGraphFixture,
  seedForgeGraphFixture,
  type ForgeGraphFixture,
} from "./utils/forgegraph-fixture";

const isBetaBypass = process.env.BETA_AUTH_BYPASS === "true";
let fixture: ForgeGraphFixture | null = null;

test.beforeEach(async () => {
  if (isBetaBypass) {
    fixture = await seedForgeGraphFixture();
  }
});

test.afterEach(async () => {
  await cleanupForgeGraphFixture(fixture);
  fixture = null;
});

test.describe("Dashboard", () => {
  test("should redirect to sign-in when not authenticated", async ({ page }) => {
    await page.goto("/dashboard");
    if (isBetaBypass) {
      await expect(page).toHaveURL(/.*dashboard\/[^/]+\/tasks\/ideas/);
    } else {
      await expect(page).toHaveURL(/.*login/);
    }
  });

  test("should show workspace selection after login", async ({ page }) => {
    await page.goto("/dashboard");

    if (isBetaBypass) {
      await expect(page).toHaveURL(/.*dashboard\/[^/]+\/tasks\/ideas/);
      return;
    }

    const signInVisible = await page.getByRole("heading", { name: "Welcome back" }).isVisible();
    expect(signInVisible).toBeTruthy();
  });
});

test.describe("Dashboard with Auth Bypass", () => {
  test.skip(
    !process.env.BETA_AUTH_BYPASS,
    "Requires BETA_AUTH_BYPASS environment variable"
  );

  test("should show dashboard overview", async ({ page }) => {
    await page.goto("/dashboard");
    
    await expect(page.getByRole("heading", { name: "Ideas Funnel" })).toBeVisible();
  });

  test("should navigate to workspace", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/.*dashboard\/[^/]+\/tasks\/ideas/);
  });

  test("should access settings from dashboard", async ({ page }) => {
    await page.goto("/dashboard/settings");
    
    await expect(page.getByText("Settings")).toBeVisible();
    await expect(page.getByText("Profile")).toBeVisible();
  });
});
