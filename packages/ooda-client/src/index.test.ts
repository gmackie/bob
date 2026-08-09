import { describe, expect, it } from "vitest";

import { createOodaClient } from "./index";

describe("createOodaClient", () => {
  it("returns the canonical typed V1 client", () => {
    const client = createOodaClient("https://ooda.example");

    expect(client.conversations.list).toBeTypeOf("function");
    expect(client.events.append).toBeTypeOf("function");
    expect(client.proposals.decide).toBeTypeOf("function");
    expect(client.voice.createGrant).toBeTypeOf("function");
  });
});
