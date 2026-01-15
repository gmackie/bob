import { expect, selectors, test } from "../fixtures/test-setup";

const TEST_PAGE = "/test-components?component=resolved-input";

test.describe("ResolvedInputCard", () => {
  test.describe("Human Resolution", () => {
    test("displays human resolution styling", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=human`);
      const card = page.locator(selectors.resolvedInputCard);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-resolution-type", "human");
    });

    test("displays Human Response label", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=human`);
      const label = page.locator(selectors.resolutionTypeLabel);
      await expect(label).toContainText("Human Response");
    });

    test("displays question", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=human`);
      const question = page.locator(selectors.resolvedQuestion);
      await expect(question).toContainText("Q: Which option did you choose?");
    });

    test("displays user answer", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=human`);
      const answer = page.locator(selectors.resolvedAnswer);
      await expect(answer).toContainText("A: User selected Option B");
    });
  });

  test.describe("Timeout Resolution", () => {
    test("displays timeout resolution styling", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=timeout`);
      const card = page.locator(selectors.resolvedInputCard);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-resolution-type", "timeout");
    });

    test("displays Auto-resolved label", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=timeout`);
      const label = page.locator(selectors.resolutionTypeLabel);
      await expect(label).toContainText("Auto-resolved (timeout)");
    });

    test("displays timeout answer", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=timeout`);
      const answer = page.locator(selectors.resolvedAnswer);
      await expect(answer).toContainText("A: Default action taken");
    });
  });
});
