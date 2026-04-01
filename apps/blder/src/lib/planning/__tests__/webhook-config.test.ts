import { describe, expect, it } from "vitest";

import {
  getPlanningWebhookSecret,
  isPlanningWebhookHeader,
} from "../webhook-config";

describe("planning webhook config", () => {
  it("reads the planning webhook secret", () => {
    expect(
      getPlanningWebhookSecret({
        PLANNING_WEBHOOK_SECRET: "planning-secret",
      }),
    ).toBe("planning-secret");
  });

  it("returns null when the planning webhook secret is absent", () => {
    expect(getPlanningWebhookSecret({})).toBeNull();
  });

  it("recognizes planning webhook headers", () => {
    expect(isPlanningWebhookHeader("x-planning-event")).toBe(true);
    expect(isPlanningWebhookHeader("x-planning-signature")).toBe(true);
    expect(isPlanningWebhookHeader("x-webhook-event")).toBe(true);
    expect(isPlanningWebhookHeader("content-type")).toBe(true);
    expect(isPlanningWebhookHeader("authorization")).toBe(false);
  });
});
