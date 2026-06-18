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
