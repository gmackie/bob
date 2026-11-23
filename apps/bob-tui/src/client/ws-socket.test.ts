import { describe, expect, it } from "vitest";

import { socketOptions } from "./ws-socket";

describe("socketOptions", () => {
  it("authenticates with the device key and sends no Origin", () => {
    const options = socketOptions("bob_key");
    expect(options.headers).toEqual({ Authorization: "Bearer bob_key" });
    expect(options.origin).toBeUndefined();
  });

  it("races IPv6 and IPv4 so a broken IPv6 route cannot time the connect out (GMA-769)", () => {
    expect(socketOptions("bob_key")).toMatchObject({ autoSelectFamily: true });
  });
});
