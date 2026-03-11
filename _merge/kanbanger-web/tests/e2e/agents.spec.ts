import { test, expect } from "@playwright/test";

test.describe("AI Agents Settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/settings");
  });

  test("should show AI Agents tab in settings navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /AI Agents/i })).toBeVisible();
  });

  test("should navigate to AI Agents settings", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await expect(page.getByText("Configure AI agents")).toBeVisible();
  });

  test("should show agent stats when workspace has agents", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    
    await expect(page.getByText("Active Now")).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();
    await expect(page.getByText("Failed")).toBeVisible();
  });

  test("should show How Agents Work card", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    
    await expect(page.getByText("How Agents Work")).toBeVisible();
    await expect(page.getByText("Claim Tasks")).toBeVisible();
    await expect(page.getByText("Work Autonomously")).toBeVisible();
    await expect(page.getByText("Hand Off When Stuck")).toBeVisible();
  });

  test("should open create agent modal", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();
    
    await expect(page.getByText("Create AI Agent")).toBeVisible();
    await expect(page.getByLabel("Agent Name")).toBeVisible();
    await expect(page.getByLabel("Agent Email")).toBeVisible();
  });

  test("should validate agent form inputs", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();
    
    const createButton = page.getByRole("button", { name: "Create Agent" });
    await expect(createButton).toBeDisabled();
    
    await page.getByLabel("Agent Name").fill("Test Agent");
    await expect(createButton).toBeDisabled();
    
    await page.getByLabel("Agent Email").fill("test@example.com");
    await expect(createButton).toBeEnabled();
  });

  test("should close create modal on cancel", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();
    
    await expect(page.getByText("Create AI Agent")).toBeVisible();
    
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Create AI Agent")).not.toBeVisible();
  });

  test("should show capability options in create modal", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();
    
    await expect(page.getByText("Code Changes")).toBeVisible();
    await expect(page.getByText("Documentation")).toBeVisible();
    await expect(page.getByText("Testing")).toBeVisible();
    await expect(page.getByText("Code Review")).toBeVisible();
    await expect(page.getByText("Planning")).toBeVisible();
  });

  test("should toggle capabilities on click", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();

    const codeCapabilityRow = page
      .getByText("Code Changes", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]");

    await expect(codeCapabilityRow).toBeVisible();
    await codeCapabilityRow.click();
    await expect(codeCapabilityRow).toHaveClass(/border-primary/);
    await expect(codeCapabilityRow).toHaveClass(/bg-primary\/5/);

    await codeCapabilityRow.click();
    await expect(codeCapabilityRow).not.toHaveClass(/border-primary/);
    await expect(codeCapabilityRow).not.toHaveClass(/bg-primary\/5/);
  });

  test("should show avatar color picker", async ({ page }) => {
    await page.getByRole("button", { name: /AI Agents/i }).click();
    await page.getByRole("button", { name: "New Agent" }).click();
    
    await expect(page.getByText("Avatar Color")).toBeVisible();
    const colorButtons = page.locator("button.rounded-full");
    await expect(colorButtons).toHaveCount(6);
  });
});

test.describe("Settings Navigation", () => {
  test("should navigate between settings tabs", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByText("Profile Information", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Workspaces" }).click();
    await expect(page.getByText("Your Workspaces")).toBeVisible();

    await page.getByRole("button", { name: "Integrations" }).click();
    await expect(page.getByText("Git Integrations")).toBeVisible();

    await page.getByRole("button", { name: "Webhooks" }).click();
    await expect(page.getByText("Outbound Webhooks")).toBeVisible();

    await page.getByRole("button", { name: /AI Agents/i }).click();
    await expect(
      page.getByText("Configure AI agents that can autonomously work on tasks.", {
        exact: true,
      })
    ).toBeVisible();

    await page.getByRole("button", { name: "API Keys" }).click();
    await expect(page.getByText("Manage API keys for programmatic access to your account.")).toBeVisible();

    await page.getByRole("button", { name: "Appearance" }).click();
    await expect(page.getByText("Current theme:")).toBeVisible();
  });
});
