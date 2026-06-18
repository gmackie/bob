import { describe, expect, it } from "vitest";

import * as workItemsSchemaModule from "./schema";

describe("work-items schema module", () => {
  it("exports the REST input schemas needed by downstream consumers", () => {
    expect(workItemsSchemaModule).toMatchObject({
      listWorkItemsInputSchema: expect.any(Object),
      getWorkItemInputSchema: expect.any(Object),
      updateWorkItemInputSchema: expect.any(Object),
      createCommentInputSchema: expect.any(Object),
    });
  });

  it("parses a minimal work item update payload", () => {
    const schema = (workItemsSchemaModule as Record<string, unknown>)
      .updateWorkItemInputSchema as
      | {
          parse: (value: unknown) => unknown;
        }
      | undefined;

    expect(schema).toBeDefined();

    if (!schema) {
      return;
    }

    expect(
      schema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Updated title",
        status: "in_progress",
      }),
    ).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Updated title",
      status: "in_progress",
    });
  });
});
