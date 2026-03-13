import { describe, expect, it } from "vitest";

import { getManagedSessionLabel } from "./session-copy";

describe("session copy", () => {
  it("uses task-linked wording for managed sessions", () => {
    expect(getManagedSessionLabel(true)).toBe("Task-linked session");
  });

  it("returns no label for unmanaged sessions", () => {
    expect(getManagedSessionLabel(false)).toBeNull();
  });
});
