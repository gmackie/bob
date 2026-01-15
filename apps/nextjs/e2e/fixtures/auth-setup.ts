import { test as setup } from "@playwright/test";

setup("authenticate", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    document.cookie = "better-auth.session_token=test-session-token; path=/";
    localStorage.setItem("auth-token", "test-token");
  });

  await page.context().storageState({ path: "./e2e/.auth/user.json" });
});
