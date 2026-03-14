import { expect, test } from "@playwright/test";

test("system status panel renders in the component harness", async ({
  page,
}) => {
  await page.goto("/test-components?component=system-status");
  await expect(page.getByText("System Status")).toBeVisible();
});
