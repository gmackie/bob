import { expect, selectors, test } from "../fixtures/test-setup";
import {
  createAwaitingInputMessage,
  createInputResolvedMessage,
  createWorkflowStatusMessage,
  WsMessageTypes,
} from "../fixtures/ws-mock";

test.describe("Workflow State Transitions", () => {
  test.beforeAll(() => {
    console.log(
      "SKIPPED: Tests require auth bypass - see apps/nextjs/e2e/README.md",
    );
  });
  test.describe("WebSocket Status Updates", () => {
    test("workflow badge updates when WebSocket sends status change", async ({
      page,
      wsMock,
    }) => {
      const ws = await wsMock({
        initialMessages: [
          { type: WsMessageTypes.CONNECTED, payload: {} },
          { type: WsMessageTypes.AUTHENTICATED, payload: {} },
        ],
      });

      await page.goto(
        "/test-components?component=session-header&variant=working",
      );

      const badge = page.locator(selectors.workflowStatusBadge);
      await expect(badge).toHaveAttribute("data-workflow-status", "working");

      await ws.sendMessage(
        createWorkflowStatusMessage(
          "test-session",
          "awaiting_input",
          "Need user input",
          {
            question: "Test question?",
            options: ["A", "B"],
            defaultAction: "A",
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          },
        ),
      );

      await page.waitForTimeout(200);
    });
  });

  test.describe("Status Transitions", () => {
    const workflowTransitions = [
      { from: "started", to: "working" },
      { from: "working", to: "awaiting_input" },
      { from: "working", to: "blocked" },
      { from: "working", to: "awaiting_review" },
      { from: "working", to: "completed" },
      { from: "awaiting_input", to: "working" },
      { from: "blocked", to: "working" },
      { from: "awaiting_review", to: "working" },
      { from: "awaiting_review", to: "completed" },
    ];

    for (const transition of workflowTransitions) {
      test(`can transition from ${transition.from} to ${transition.to}`, async ({
        page,
      }) => {
        await page.goto(
          `/test-components?component=session-header&variant=${transition.from}`,
        );

        const badge = page.locator(selectors.workflowStatusBadge);
        await expect(badge).toHaveAttribute(
          "data-workflow-status",
          transition.from,
        );
      });
    }
  });

  test.describe("Awaiting Input Flow", () => {
    test("shows awaiting input card when status is awaiting_input", async ({
      page,
    }) => {
      await page.goto("/test-components?component=awaiting-input");
      const card = page.locator(selectors.awaitingInputCard);
      await expect(card).toBeVisible();
    });

    test("resolving input returns to working state", async ({ page }) => {
      await page.goto("/test-components?component=awaiting-input");

      await page.locator(selectors.inputOption(0)).click();

      const result = page.locator("[data-testid='resolution-result']");
      await expect(result).toBeVisible();
    });

    test("timeout shows resolved card with timeout type", async ({ page }) => {
      await page.goto(
        "/test-components?component=resolved-input&variant=timeout",
      );

      const card = page.locator(selectors.resolvedInputCard);
      await expect(card).toHaveAttribute("data-resolution-type", "timeout");
    });
  });

  test.describe("All Workflow States Render", () => {
    const allStates = [
      "started",
      "working",
      "awaiting_input",
      "blocked",
      "awaiting_review",
      "completed",
    ];

    for (const state of allStates) {
      test(`${state} state renders correctly`, async ({ page }) => {
        await page.goto(
          `/test-components?component=session-header&variant=${state}`,
        );

        const badge = page.locator(selectors.workflowStatusBadge);
        await expect(badge).toBeVisible();
        await expect(badge).toHaveAttribute("data-workflow-status", state);
      });
    }
  });

  test.describe("Combined Session and Workflow Status", () => {
    test("running session with working workflow", async ({ page }) => {
      await page.goto(
        "/test-components?component=session-header&variant=working&sessionStatus=running",
      );

      const sessionBadge = page.locator(selectors.sessionStatusBadge);
      const workflowBadge = page.locator(selectors.workflowStatusBadge);

      await expect(sessionBadge).toHaveAttribute("data-status", "running");
      await expect(workflowBadge).toHaveAttribute(
        "data-workflow-status",
        "working",
      );
    });

    test("idle session with awaiting_input workflow", async ({ page }) => {
      await page.goto(
        "/test-components?component=session-header&variant=awaiting_input&sessionStatus=idle",
      );

      const sessionBadge = page.locator(selectors.sessionStatusBadge);
      const workflowBadge = page.locator(selectors.workflowStatusBadge);

      await expect(sessionBadge).toHaveAttribute("data-status", "idle");
      await expect(workflowBadge).toHaveAttribute(
        "data-workflow-status",
        "awaiting_input",
      );
    });

    test("stopped session with completed workflow", async ({ page }) => {
      await page.goto(
        "/test-components?component=session-header&variant=completed&sessionStatus=stopped",
      );

      const sessionBadge = page.locator(selectors.sessionStatusBadge);
      const workflowBadge = page.locator(selectors.workflowStatusBadge);

      await expect(sessionBadge).toHaveAttribute("data-status", "stopped");
      await expect(workflowBadge).toHaveAttribute(
        "data-workflow-status",
        "completed",
      );
    });
  });
});
