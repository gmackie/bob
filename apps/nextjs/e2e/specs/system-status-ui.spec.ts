import { expect, test } from "@playwright/test";

test("homepage renders System Status panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("System Status")).toBeVisible();
});
