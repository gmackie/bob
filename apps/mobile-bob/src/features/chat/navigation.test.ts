import { describe, expect, it } from "vitest";

import { getAuthenticatedHomeHref } from "./navigation";

describe("authenticated chat navigation", () => {
  it("opens triage as the authenticated home on phones and iPads", () => {
    // Changed deliberately: home-mode-model has always specified triage as the
    // phone home ("Phone home is always triage, regardless of mode"), but this
    // returned /chat, so the app opened on a conversation and never showed
    // what was waiting on you. Chat is still one tap away from the home screen
    // and the nav sheet.
    expect(getAuthenticatedHomeHref({ isTablet: false })).toBe("/home");
    expect(getAuthenticatedHomeHref({ isTablet: true })).toBe("/home");
  });
});
