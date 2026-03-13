import { describe, expect, it } from "vitest";

import {
  getPlanningWebhookSecret,
  isPlanningWebhookHeader,
} from "../webhook-config";

describe("planning webhook config", () => {
  it("prefers planning webhook secrets over legacy names", () => {
    expect(
      getPlanningWebhookSecret({
        PLANNING_WEBHOOK_SECRET: "planning-secret",
        KANBANGER_WEBHOOK_SECRET: "legacy-secret",
      }),
    ).toBe("planning-secret");
  });

  it("falls back to the legacy webhook secret name", () => {
    expect(
      getPlanningWebhookSecret({
        KANBANGER_WEBHOOK_SECRET: "legacy-secret",
      }),
    ).toBe("legacy-secret");
  });

  it("recognizes planning webhook headers", () => {
    expect(isPlanningWebhookHeader("x-planning-event")).toBe(true);
    expect(isPlanningWebhookHeader("x-planning-signature")).toBe(true);
    expect(isPlanningWebhookHeader("x-webhook-event")).toBe(true);
    expect(isPlanningWebhookHeader("content-type")).toBe(true);
    expect(isPlanningWebhookHeader("authorization")).toBe(false);
  });
});
