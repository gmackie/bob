import { describe, expect, it } from "vitest";

import {
  createCommentInputSchema,
  getWorkItemInputSchema,
  listWorkItemsInputSchema,
  updateWorkItemInputSchema,
} from "./schema";

describe("work-items schema module", () => {
  it("exports the REST input schemas needed by downstream consumers", () => {
    // See client.test.ts for why this asserts each export individually
    // rather than via `toMatchObject({ ...: expect.any(Object) })` — vitest's
    // `expect.any()` is declared to return `any`, which trips
    // no-unsafe-assignment on every property in an object literal.
    expect(typeof listWorkItemsInputSchema).toBe("object");
    expect(typeof getWorkItemInputSchema).toBe("object");
    expect(typeof updateWorkItemInputSchema).toBe("object");
    expect(typeof createCommentInputSchema).toBe("object");
  });

  it("parses a minimal work item update payload", () => {
    expect(
      updateWorkItemInputSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Updated title",
        status: "in_progress",
        priority: "high",
      }),
    ).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Updated title",
      status: "in_progress",
      priority: "high",
    });
  });
});
