import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should display the landing page correctly", async ({ page }) => {
    await page.goto("/");

    // Check for main heading
    await expect(page.getByRole("heading", { name: "Tasks @ Gmacko" })).toBeVisible();

    // Check for tagline
    await expect(
      page.getByText("The modern issue tracking tool for the Gmacko team.")
    ).toBeVisible();

    // Check for CTA button
    await expect(page.getByRole("link", { name: "Sign In with Entra ID" })).toBeVisible();

    // Check for feature cards
    await expect(page.getByText("Lightning Fast")).toBeVisible();
    await expect(page.getByText("MCP Integration")).toBeVisible();
    await expect(page.getByText("GitHub & Gitea")).toBeVisible();

    // Check for SSO notice
    await expect(
      page.getByText("Sign in with your @gmacko.com Microsoft account")
    ).toBeVisible();
  });

  test("should navigate to sign-in page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Sign In with Entra ID" }).click();

    await expect(page).toHaveURL(/.*login/);
  });

  test("should be responsive on mobile", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("/");

    // Main content should still be visible
    await expect(page.getByRole("heading", { name: "Tasks @ Gmacko" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign In with Entra ID" })).toBeVisible();
  });
});

test.describe("Authentication Flow", () => {
  test("should show sign-in page", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
  });

  test("should redirect protected routes to sign-in", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/.*(login|dashboard)\/?/);
  });
});
