import { describe, expect, it } from "vitest";

import {
  conversationUrlForLegacyThread,
  conversationsUrlForLegacyList,
} from "./legacy-routes";

describe("legacy conversation routes", () => {
  it("maps a migrated research thread to its ID-preserving conversation", () => {
    expect(conversationUrlForLegacyThread("thread/id with spaces")).toBe(
      "/conversations?conversation=thread%2Fid%20with%20spaces",
    );
  });

  it("preserves the legacy new-thread intent", () => {
    expect(conversationsUrlForLegacyList("?new=1")).toBe(
      "/conversations?new=1",
    );
    expect(conversationsUrlForLegacyList("")).toBe("/conversations");
  });
});
