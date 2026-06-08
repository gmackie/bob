import { describe, expect, it } from "vitest";

import { getChatPanelSessionHref } from "../chat-panel-model";

describe("chat panel model", () => {
  it("opens the full session page inside the selected workspace", () => {
    expect(getChatPanelSessionHref("session-1", "workspace-1")).toBe(
      "/sessions/session-1?workspace=workspace-1",
    );
  });

  it("keeps the legacy session href when no workspace is known", () => {
    expect(getChatPanelSessionHref("session-1", null)).toBe("/sessions/session-1");
  });
});
