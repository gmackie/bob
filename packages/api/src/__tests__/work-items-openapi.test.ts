import { describe, expect, it } from "vitest";

import { generateApiDocument } from "../openapi";

describe("work item OpenAPI document", () => {
  it("publishes RPC-style work item paths", () => {
    const document = generateApiDocument();

    expect(document.paths).toBeDefined();

    const listOperation = document.paths?.["/api/v1/work-items/list"]?.post;
    const createCommentOperation =
      document.paths?.["/api/v1/work-items/create-comment"]?.post;

    expect(listOperation).toBeDefined();
    expect(listOperation?.tags).toContain("workItems");
    expect(listOperation?.security).toEqual([{ cookieAuth: [] }]);

    expect(createCommentOperation).toBeDefined();
    expect(createCommentOperation?.tags).toContain("workItems");
  });
});
