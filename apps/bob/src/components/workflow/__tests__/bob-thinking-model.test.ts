import { describe, expect, it } from "vitest";

import { getBobThinkingSessionHref } from "../bob-thinking-model";

describe("bob thinking model", () => {
  it("links active execution sessions inside the selected workspace", () => {
    expect(getBobThinkingSessionHref("session-1", "workspace-1")).toBe(
      "/sessions/session-1?workspace=workspace-1",
    );
  });

  it("keeps the legacy session href when no workspace is known", () => {
    expect(getBobThinkingSessionHref("session-1", null)).toBe("/sessions/session-1");
  });
});
