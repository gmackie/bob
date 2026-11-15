import { describe, expect, it } from "vitest";

import {
  getNotificationDestination,
  getNotificationPreviewSubtitle,
} from "./notifications";

describe("mobile notification helpers", () => {
  it("prefers an explicit in-app destination url", () => {
    expect(
      getNotificationDestination({
        url: "https://builder.example.com/work-items/task-123/workspace",
        workItemId: "task-123",
      }),
    ).toBe("/work-items/task-123/workspace");
  });

  it("falls back to the linked work-item detail route", () => {
    expect(
      getNotificationDestination({
        url: null,
        workItemId: "task-123",
      }),
    ).toBe("/work-items/task-123");
  });

  it("opens SDLC inbox rows on the Attention tab", () => {
    const dest = (url: string) => getNotificationDestination({ url, workItemId: null });
    expect(dest("/sdlc?item=item-71")).toBe("/attention/item-71");
    expect(dest("/sdlc?item=BOB-71%3Aa1")).toBe("/attention/BOB-71%3Aa1");
    expect(dest("https://bob.example.com/sdlc?item=item-71")).toBe("/attention/item-71");
    expect(dest("/sdlc")).toBe("/attention");
    // Not a plain id: the Attention list, never another route.
    expect(dest("/sdlc?item=..%2Fsettings")).toBe("/attention");
    expect(dest("/sdlc?item=a%2Fb")).toBe("/attention");
    expect(dest("/sdlc?item=")).toBe("/attention");
    expect(dest("/sdlc?item=a%3Fx%3D1")).toBe("/attention");
  });

  it("returns the inbox route when no destination is available", () => {
    expect(
      getNotificationDestination({
        url: null,
        workItemId: null,
      }),
    ).toBe("/notifications");
  });

  it("formats preview subtitles from body or type", () => {
    expect(
      getNotificationPreviewSubtitle({
        body: "Bob is waiting for guidance",
        type: "work_item_needs_input",
      }),
    ).toBe("Bob is waiting for guidance");

    expect(
      getNotificationPreviewSubtitle({
        body: null,
        type: "work_item_review_ready",
      }),
    ).toBe("work item review ready");
  });
});
