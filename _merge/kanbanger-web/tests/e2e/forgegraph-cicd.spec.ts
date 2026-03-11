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

test.describe("ForgeGraph CI/CD", () => {
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

  test("shows forge overview with seeded revision and build context", async ({ page }) => {
    const testFixture = getFixture();

    await page.goto(`/dashboard/${testFixture.workspaceSlug}/forge`);

    await expect(page.getByRole("heading", { name: "ForgeGraph" })).toBeVisible();
    await expect(page.getByText("Latest Build")).toBeVisible();
    await expect(page.getByText(testFixture.revisionId)).toBeVisible();
    await expect(page.getByText("revision-centric CI/CD observability")).toBeVisible();
  });

  test("shows build detail sections with artifacts and links", async ({ page }) => {
    const testFixture = getFixture();

    await page.goto(`/dashboard/${testFixture.workspaceSlug}/forge/builds/${testFixture.buildIds[0]}`);

    await expect(page.getByRole("heading", { name: "Build Metadata" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build Artifacts" })).toBeVisible();
    await expect(page.getByText("Repository:")).toBeVisible();
    await expect(page.getByText("CI Provider:")).toBeVisible();
    await expect(page.getByText("Image digest:")).toBeVisible();
    await expect(page.getByText("Download")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "https://example.com/artifacts/passed-junit.xml"
    );
    await expect(page.getByText("View parent revision")).toBeVisible();
    await expect(page.getByText("View run")).toBeVisible();
  });
});
