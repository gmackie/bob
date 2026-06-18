import { describe, it, expect } from "vitest";
import { createRunnerTRPCClient } from "../trpc-client";

describe("createRunnerTRPCClient", () => {
  it("creates a client without throwing", () => {
    const client = createRunnerTRPCClient("http://localhost:3000");
    expect(client).toBeDefined();
    expect(client.threads).toBeDefined();
    expect(client.runner).toBeDefined();
  });
});
