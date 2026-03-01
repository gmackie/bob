import { expect, test } from "../fixtures/test-setup";

const TEST_PAGE = "/test-components?component=session-list";

test.describe("SessionList", () => {
  test("supports keyboard navigation for filter chips", async ({ page }) => {
    await page.goto(TEST_PAGE);

    const allFilter = page.getByRole("tab", { name: "All" });
    const runningFilter = page.getByRole("tab", { name: "Running" });
    const errorFilter = page.getByRole("tab", { name: "Error" });

    await expect(allFilter).toHaveAttribute("aria-selected", "true");
    await allFilter.focus();

    await page.keyboard.press("ArrowRight");
    await expect(runningFilter).toBeFocused();
    await expect(runningFilter).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("running sessions · No filter")).toBeVisible();
    await expect(page.getByText("Alpha Session")).toBeVisible();
    await expect(page.getByText("Epsilon Session")).toBeVisible();
    await expect(page.getByText("Beta Session")).not.toBeVisible();

    await page.keyboard.press("End");
    await expect(errorFilter).toBeFocused();
    await expect(errorFilter).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("error sessions · No filter")).toBeVisible();
    await expect(page.getByText("Delta Session")).toBeVisible();
    await expect(page.getByText("Alpha Session")).not.toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(allFilter).toBeFocused();
    await expect(allFilter).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("All sessions · No filter")).toBeVisible();
  });
});
