import { describe, expect, it } from "vitest";

import {
  createBobClient,
  createBobRpcClient,
  __bobClientPhase,
} from "@gmacko/bob-client";

describe("@gmacko/bob-client package exports", () => {
  it("exports the Effect-RPC client and the legacy OpenAPI helper", () => {
    expect(createBobRpcClient).toBeTypeOf("function");
    expect(createBobClient).toBeTypeOf("function");
    expect(__bobClientPhase).toBe("effect-rpc-client");
  });
});
