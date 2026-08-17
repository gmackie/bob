import { describe, expect, it } from "vitest";

import { getAuthenticatedHomeHref } from "./navigation";

describe("authenticated chat navigation", () => {
  it("opens OODA chat as the authenticated home on phones and iPads", () => {
    expect(getAuthenticatedHomeHref({ isTablet: false })).toBe("/chat");
    expect(getAuthenticatedHomeHref({ isTablet: true })).toBe("/chat");
  });
});
