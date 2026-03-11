import { expect, selectors, test } from "../fixtures/test-setup";

const TEST_PAGE = "/test-components?component=session-header";

test.describe("SessionHeader", () => {
  test.describe("Session Status Badge", () => {
    test("displays running status correctly", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&sessionStatus=running`);
      const badge = page.locator(selectors.sessionStatusBadge);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("data-status", "running");
      await expect(badge).toContainText("Running");
    });

    test("displays idle status correctly", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&sessionStatus=idle`);
      const badge = page.locator(selectors.sessionStatusBadge);
      await expect(badge).toHaveAttribute("data-status", "idle");
      await expect(badge).toContainText("Idle");
    });

    test("displays stopped status correctly", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&sessionStatus=stopped`);
      const badge = page.locator(selectors.sessionStatusBadge);
      await expect(badge).toHaveAttribute("data-status", "stopped");
      await expect(badge).toContainText("Stopped");
    });

    test("displays error status correctly", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&sessionStatus=error`);
      const badge = page.locator(selectors.sessionStatusBadge);
      await expect(badge).toHaveAttribute("data-status", "error");
      await expect(badge).toContainText("Error");
    });

    test("displays starting status with animation", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&sessionStatus=starting`);
      const badge = page.locator(selectors.sessionStatusBadge);
      await expect(badge).toHaveAttribute("data-status", "starting");
      await expect(badge).toContainText("Starting");
    });
  });

  test.describe("Workflow Status Badge", () => {
    test("displays started workflow status", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=started`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("data-workflow-status", "started");
      await expect(badge).toContainText("Started");
    });

    test("displays working workflow status with spinner", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=working`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute("data-workflow-status", "working");
      await expect(badge).toContainText("Working");
    });

    test("displays awaiting_input workflow status", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=awaiting_input`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute(
        "data-workflow-status",
        "awaiting_input",
      );
      await expect(badge).toContainText("Awaiting Input");
    });

    test("displays blocked workflow status", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=blocked`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute("data-workflow-status", "blocked");
      await expect(badge).toContainText("Blocked");
    });

    test("displays awaiting_review workflow status", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=awaiting_review`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute(
        "data-workflow-status",
        "awaiting_review",
      );
      await expect(badge).toContainText("Awaiting Review");
    });

    test("displays completed workflow status", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&variant=completed`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute("data-workflow-status", "completed");
      await expect(badge).toContainText("Completed");
    });

    test("workflow badge not present without workflow state", async ({
      page,
    }) => {
      await page.goto(`${TEST_PAGE}`);
      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).not.toBeVisible();
    });
  });

  test.describe("Header Content", () => {
    test("displays session title", async ({ page }) => {
      await page.goto(TEST_PAGE);
      const title = page.locator(selectors.sessionTitle);
      await expect(title).toBeVisible();
      await expect(title).toContainText("Test Session");
    });

    test("displays agent type", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await expect(page.locator("text=opencode")).toBeVisible();
    });

    test("displays git branch", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await expect(page.locator("text=feature/test")).toBeVisible();
    });
  });

  test.describe("PR Badge", () => {
    test("displays PR badge when PR is linked", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&withPr=true`);
      await expect(page.locator("text=#42")).toBeVisible();
    });

    test("does not display PR badge when no PR linked", async ({ page }) => {
      await page.goto(TEST_PAGE);
      await expect(page.locator("text=#42")).not.toBeVisible();
    });
  });

  test.describe("Task Badge", () => {
    test("displays task badge when task is linked", async ({ page }) => {
      await page.goto(`${TEST_PAGE}&withTask=true`);
      await expect(page.locator("text=PROJ-123")).toBeVisible();
    });

    test("does not display task badge when no task linked", async ({
      page,
    }) => {
      await page.goto(TEST_PAGE);
      await expect(page.locator("text=PROJ-123")).not.toBeVisible();
    });
  });

  test("shows linked issue session metadata and Kanbanger deep link", async ({
    page,
  }) => {
    await page.goto(`${TEST_PAGE}&withTask=true&issueManaged=true`);
    await expect(page.locator("text=Issue-managed session")).toBeVisible();
    const link = page.getByRole("link", { name: "Open in Kanbanger" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /linear\.app|Kanbanger|issues/);
  });

  test("remains within narrow viewport with long metadata", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const url = `${TEST_PAGE}`
      + `&sessionStatus=running`
      + `&title=${encodeURIComponent(
        "This is a long-form session title that verifies wrapping and overflow behavior",
      )}`
      + `&agentType=${encodeURIComponent("opencode-ui")}`
      + `&gitBranch=${encodeURIComponent("feature/very-long-and-detailed-branch-name-for-testing")}`
      + `&workingDirectory=${encodeURIComponent(
        "/Users/alice/projects/very-long-repository-directory-name/with/verbose/path/segments",
      )}`
      + "&withPr=true"
      + "&withTask=true";

    await page.goto(url);

    const hasOverflow = await page.evaluate(() => {
      const width = window.innerWidth;

      return [
        ".chat-sessionHeader",
        ".chat-sessionHeaderMeta",
        ".chat-sessionHeaderTopline",
        ".chat-sessionHeaderMetaRow",
        ".chat-sessionHeaderBadges",
        ".chat-sessionHeaderActions",
        ".chat-sessionHeaderMetaValue",
      ].some((selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
    });

    expect(hasOverflow).toBeFalsy();
  });
});
