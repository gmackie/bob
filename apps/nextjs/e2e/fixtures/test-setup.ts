import { test as base, expect } from "@playwright/test";

import type { TrpcMockHandlers } from "./trpc-mock";
import type { WebSocketMock, WebSocketMockOptions } from "./ws-mock";
import { mockTrpc } from "./trpc-mock";
import { setupWebSocketMock } from "./ws-mock";

interface TestFixtures {
  mockApi: (handlers: TrpcMockHandlers) => Promise<void>;
  wsMock: (options?: WebSocketMockOptions) => Promise<WebSocketMock>;
  bypassAuth: () => Promise<void>;
}

export const test = base.extend<TestFixtures>({
  mockApi: async ({ page }, use) => {
    await use(async (handlers: TrpcMockHandlers) => {
      await mockTrpc(page, handlers);
    });
  },
  wsMock: async ({ page }, use) => {
    await use(async (options?: WebSocketMockOptions) => {
      return setupWebSocketMock(page, options);
    });
  },
  bypassAuth: async ({ context }, use) => {
    await use(async () => {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: "test-session-token-12345",
          domain: "localhost",
          path: "/",
        },
      ]);
    });
  },
});

export { expect };

export const selectors = {
  sessionHeader: "[data-testid='session-header']",
  sessionTitle: "[data-testid='session-title']",
  sessionStatusBadge: "[data-testid='session-status-badge']",
  workflowStatusBadge: "[data-testid='workflow-status-badge']",
  awaitingInputCard: "[data-testid='awaiting-input-card']",
  timeRemaining: "[data-testid='time-remaining']",
  inputQuestion: "[data-testid='input-question']",
  inputOptions: "[data-testid='input-options']",
  inputOption: (idx: number) => `[data-testid='input-option-${idx}']`,
  customResponseSection: "[data-testid='custom-response-section']",
  customResponseInput: "[data-testid='custom-response-input']",
  customResponseSubmit: "[data-testid='custom-response-submit']",
  defaultActionInfo: "[data-testid='default-action-info']",
  resolvedInputCard: "[data-testid='resolved-input-card']",
  resolutionTypeLabel: "[data-testid='resolution-type-label']",
  resolvedQuestion: "[data-testid='resolved-question']",
  resolvedAnswer: "[data-testid='resolved-answer']",
};
