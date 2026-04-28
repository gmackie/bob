import { describe, it, expect } from "vitest";
import { __gmackoNotificationsPhase } from "@gmacko/core/notifications";

describe("@gmacko/notifications package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoNotificationsPhase).toBe("6l");
  });
});
