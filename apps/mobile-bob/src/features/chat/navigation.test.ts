import { describe, expect, it } from "vitest";

import { getAuthenticatedHomeHref } from "./navigation";

describe("authenticated mobile home", () => {
  it("opens OODA chat directly on phones", () => {
    expect(getAuthenticatedHomeHref({ isTablet: false })).toBe("/chat");
  });

  it("preserves the planning dashboard on tablets", () => {
    expect(getAuthenticatedHomeHref({ isTablet: true })).toBe("/tasks");
  });
});
