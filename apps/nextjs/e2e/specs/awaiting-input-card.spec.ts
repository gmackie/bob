import { expect, selectors, test } from "../fixtures/test-setup";

const TEST_PAGE = "/test-components?component=awaiting-input";

test.describe("AwaitingInputCard", () => {
  test.describe("Question Display", () => {
    test("displays the question text", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const question = page.locator(selectors.inputQuestion);
      await expect(question).toBeVisible();
      await expect(question).toContainText("Which option should I choose?");
    });

    test("displays default action info", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const defaultAction = page.locator(selectors.defaultActionInfo);
      await expect(defaultAction).toBeVisible();
      await expect(defaultAction).toContainText(
        'Default action if no response: "Option A"',
      );
    });
  });

  test.describe("Options", () => {
    test("displays option buttons when options provided", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const optionsContainer = page.locator(selectors.inputOptions);
      await expect(optionsContainer).toBeVisible();

      await expect(page.locator(selectors.inputOption(0))).toContainText(
        "Option A",
      );
      await expect(page.locator(selectors.inputOption(1))).toContainText(
        "Option B",
      );
      await expect(page.locator(selectors.inputOption(2))).toContainText(
        "Option C",
      );
    });

    test("does not display options when no options provided", async ({
      page,
    }) => {
      await page.goto(`${TEST_PAGE}&variant=no-options`);
      const optionsContainer = page.locator(selectors.inputOptions);
      await expect(optionsContainer).not.toBeVisible();
    });

    test("clicking option triggers resolution", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await page.locator(selectors.inputOption(1)).click();

      const result = page.locator("[data-testid='resolution-result']");
      await expect(result).toContainText("Option B");
    });
  });

  test.describe("Custom Response", () => {
    test("displays custom response input", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const input = page.locator(selectors.customResponseInput);
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute(
        "placeholder",
        "Or type a custom response...",
      );
    });

    test("send button is disabled when input is empty", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const submitBtn = page.locator(selectors.customResponseSubmit);
      await expect(submitBtn).toBeDisabled();
    });

    test("send button enables when text is entered", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await page.locator(selectors.customResponseInput).fill("Custom answer");
      const submitBtn = page.locator(selectors.customResponseSubmit);
      await expect(submitBtn).toBeEnabled();
    });

    test("submitting custom response triggers resolution", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await page
        .locator(selectors.customResponseInput)
        .fill("My custom response");
      await page.locator(selectors.customResponseSubmit).click();

      const result = page.locator("[data-testid='resolution-result']");
      await expect(result).toContainText("My custom response");
    });

    test("pressing Enter submits custom response", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await page.locator(selectors.customResponseInput).fill("Enter response");
      await page.locator(selectors.customResponseInput).press("Enter");

      const result = page.locator("[data-testid='resolution-result']");
      await expect(result).toContainText("Enter response");
    });
  });

  test.describe("Time Remaining", () => {
    test("displays time remaining countdown", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const timeRemaining = page.locator(selectors.timeRemaining);
      await expect(timeRemaining).toBeVisible();
      await expect(timeRemaining).toContainText(/\d+m \d+s remaining/);
    });

    test("time remaining not shown when expired", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=expired`);
      const timeRemaining = page.locator(selectors.timeRemaining);
      await expect(timeRemaining).not.toBeVisible();
    });
  });

  test.describe("Expired State", () => {
    test("shows expired styling", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=expired`);
      const card = page.locator(selectors.awaitingInputCard);
      await expect(card).toHaveAttribute("data-expired", "true");
    });

    test("shows timeout message for expired card", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=expired`);
      const defaultAction = page.locator(selectors.defaultActionInfo);
      await expect(defaultAction).toContainText("Timed out - proceeded with:");
    });

    test("hides options when expired", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=expired`);
      const optionsContainer = page.locator(selectors.inputOptions);
      await expect(optionsContainer).not.toBeVisible();
    });

    test("hides custom response input when expired", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=expired`);
      const customInput = page.locator(selectors.customResponseSection);
      await expect(customInput).not.toBeVisible();
    });
  });

  test.describe("Non-expired state", () => {
    test("shows active styling", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const card = page.locator(selectors.awaitingInputCard);
      await expect(card).toHaveAttribute("data-expired", "false");
    });
  });
});
