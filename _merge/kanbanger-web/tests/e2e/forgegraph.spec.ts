import { expect, test } from "@playwright/test";

import {
  cleanupForgeGraphFixture,
  seedForgeGraphFixture,
  type ForgeGraphFixture,
} from "./utils/forgegraph-fixture";

let fixture: ForgeGraphFixture | null = null;

function getFixture(): ForgeGraphFixture {
  if (!fixture) {
    throw new Error("ForgeGraph fixture was not initialized");
  }

  return fixture;
}

test.describe("ForgeGraph Viewer", () => {
  test.skip(
    !process.env.BETA_AUTH_BYPASS,
    "Requires BETA_AUTH_BYPASS environment variable"
  );

  test.beforeEach(async () => {
    fixture = await seedForgeGraphFixture();
  });

  test.afterEach(async () => {
    await cleanupForgeGraphFixture(fixture);
    fixture = null;
  });

  test("shows populated revision metadata and review sections", async ({ page }) => {
    const testFixture = getFixture();

    await page.goto(`/dashboard/${testFixture.workspaceSlug}/forge`);

    await expect(page.getByRole("heading", { name: "ForgeGraph" })).toBeVisible();
    await expect(page.getByText("Recent Revisions")).toBeVisible();
    await expect(page.getByText(testFixture.revisionId)).toBeVisible();

    await page.goto(
      `/dashboard/${testFixture.workspaceSlug}/forge/revs/${encodeURIComponent(testFixture.revisionId)}?repoId=${testFixture.repositoryId}`
    );

    await expect(page.getByRole("heading", { name: "Review Change Set" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review Snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Changed Files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Related Pull Requests" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CI Results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run Context" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CI Notes" })).toBeVisible();
    await expect(page.getByText("src/web/feature.ts")).toBeVisible();
    await expect(page.getByText("src/web/utils.ts")).toBeVisible();
    await expect(page.getByText("View patch")).toHaveCount(2);
    await page.getByText("View patch").first().click();
    await expect(page.getByText("+new code")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open PR" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Open PR" }).first()).toHaveAttribute(
      "href",
      "https://github.com/linear/pull/123"
    );
    await expect(page.getByRole("link", { name: "Open PR" }).nth(1)).toHaveAttribute(
      "href",
      "https://github.com/linear/agent-pr-77"
    );
    await expect(page.getByText("Add web forge review fixtures")).toBeVisible();
    await expect(page.getByText("CI passed with staged artifacts")).toBeVisible();
    await expect(page.getByText("No tests attached yet.")).not.toBeVisible();
  });

  test("links from review page into run and build context", async ({ page }) => {
    const testFixture = getFixture();
    const runDetailLink = page.getByRole("link", { name: "View run detail" });
    const buildLinks = page.getByRole("link", { name: "View build" });

    await page.goto(
      `/dashboard/${testFixture.workspaceSlug}/forge/revs/${encodeURIComponent(testFixture.revisionId)}?repoId=${testFixture.repositoryId}`
    );

    await expect(runDetailLink).toBeVisible();
    await expect(buildLinks).toHaveCount(2);

    await runDetailLink.click();
    await expect(page.getByRole("heading", { name: "Run Detail" })).toBeVisible();
    await expect(page.getByText(testFixture.runId)).toBeVisible();
    await expect(page.getByText("https://example.com/forge-log.txt")).toBeVisible();
    await page.goBack();

    await buildLinks.first().click();
    await expect(page.getByRole("heading", { name: "Build Metadata" })).toBeVisible();
    await expect(page.getByText("Run ID")).toBeVisible();
    await expect(page.getByText("View parent revision")).toBeVisible();
  });
});
