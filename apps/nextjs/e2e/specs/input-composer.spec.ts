import { expect, selectors, test } from "../fixtures/test-setup";

const TEST_PAGE = "/test-components?component=input-composer";

test("adds a quick prompt into the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(TEST_PAGE);

  const composer = page.locator(selectors.composerTextarea);
  const promptButton = page.getByRole("button", {
    name: "Summarize key decisions and next steps",
  });

  await expect(promptButton).toBeVisible();
  await promptButton.click();

  await expect(composer).toHaveValue("Summarize key decisions and next steps");
  await expect(page.locator(selectors.inputComposerLastMessage)).toBeEmpty();

  await composer.fill("Extend this plan with tests");
  await composer.press("Enter");

  await expect(page.locator(selectors.inputComposerLastMessage)).toContainText(
    "Extend this plan with tests",
  );
});

test("toggles focus mode and keeps prompt affordance hidden in compact mobile mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEST_PAGE);

  const promptButton = page.getByRole("button", {
    name: "Refactor this with safer patterns",
  });
  const composerModeButton = page.getByRole("button", {
    name: "Focus mode",
  });
  const composerInput = page.locator(selectors.composerTextarea);

  await expect(promptButton).not.toBeVisible();
  await expect(composerModeButton).toBeVisible();
  await composerModeButton.click();
  await expect(promptButton).toBeVisible();

  await composerInput.focus();
  await composerInput.fill("Use compact controls when typing");
  await expect(promptButton).toBeVisible();
  await composerInput.press("Enter");

  await expect(page.locator(selectors.inputComposerLastMessage)).toContainText(
    "Use compact controls when typing",
  );
});
