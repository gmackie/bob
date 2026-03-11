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

  test("keeps layout within mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(TEST_PAGE);

    const hasContainerOverflow = await page.evaluate(() => {
      const width = window.innerWidth;
      const selectors = [
        ".chat-root",
        ".chat-shell",
        ".chat-sidebar",
        ".chat-sidebarBody",
        ".chat-filterRow",
        ".chat-sessionList",
      ];

      return selectors.some((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
    });

    const hasElementOverflow = await page.evaluate(() => {
      const width = window.innerWidth;
      return Array.from(
        document.querySelectorAll(".chat-filterChip, .chat-sessionItem"),
      ).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
    });

    expect(hasContainerOverflow).toBeFalsy();
    expect(hasElementOverflow).toBeFalsy();
  });

  test("keeps long titles and directories within viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${TEST_PAGE}&listVariant=long`);

    await expect(
      page.getByText(
        "A significantly longer session title designed to stress wrapping and overflow behavior",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "/tmp/long/path/example/workspace/where-the-session-directory-is-extraordinarily-long",
      ),
    ).toBeVisible();

    const hasContainerOverflow = await page.evaluate(() => {
      const width = window.innerWidth;
      const selectors = [
        ".chat-root",
        ".chat-shell",
        ".chat-sidebar",
        ".chat-sidebarBody",
        ".chat-filterRow",
        ".chat-sessionList",
      ];

      return selectors.some((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
    });

    const hasElementOverflow = await page.evaluate(() => {
      const width = window.innerWidth;
      return Array.from(
        document.querySelectorAll(
          ".chat-filterChip, .chat-sessionItem, .chat-sessionItemTitle, .chat-sessionItemDir",
        ),
      ).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
    });

    const hasTextClipping = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(
          ".chat-sessionItemTitle, .chat-sessionItemDir",
        ),
      ).some((element) => {
        if (!(element instanceof HTMLElement)) return false;
        return element.scrollWidth > element.clientWidth + 1;
      });
    });

    expect(hasContainerOverflow).toBeFalsy();
    expect(hasElementOverflow).toBeFalsy();
    expect(hasTextClipping).toBeFalsy();
  });
});
