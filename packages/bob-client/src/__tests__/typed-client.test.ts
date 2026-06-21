import { describe, expect, it } from "vitest";

import { createBobClient } from "../index.js";

describe("createBobClient (typed against generated schema)", () => {
  it("exposes openapi-fetch verb methods", () => {
    const client = createBobClient("http://127.0.0.1:0");
    expect(client.GET).toBeTypeOf("function");
    expect(client.POST).toBeTypeOf("function");
  });

  it("type-checks a known operation against schema.d.ts", () => {
    const client = createBobClient("http://127.0.0.1:0");
    // Compile-time guard: if `paths` were `unknown`/untyped, the path literal
    // and request body below would not type-check. This test passing through
    // `tsc --noEmit` is the real assertion; the runtime body is never sent.
    const probe = () =>
      client.POST("/api/v1/work-item/list", {
        body: { workspaceId: "ws_test" },
      });
    expect(probe).toBeTypeOf("function");
  });
});
