import { describe, expect, it } from "vitest";

import { edgeSocketHeaders, edgeSocketUrl, rejectedStatusFrom } from "./edge-socket";

describe("edge socket", () => {
  it("builds wss for https APIs and ws for http dev APIs", () => {
    expect(edgeSocketUrl("https://bob.blder.bot")).toBe("wss://bob.blder.bot/api/sdlc/ws");
    expect(edgeSocketUrl("http://192.168.1.5:3000")).toBe("ws://192.168.1.5:3000/api/sdlc/ws");
  });

  it("sends the session cookie with a same-origin Origin, which the edge's cookie branch requires", () => {
    expect(edgeSocketHeaders("https://bob.blder.bot/", "better-auth.session_token=abc")).toEqual({
      Cookie: "better-auth.session_token=abc",
      Origin: "https://bob.blder.bot",
    });
    expect(edgeSocketHeaders("https://bob.blder.bot", "")).toBeNull();
    expect(edgeSocketHeaders("https://bob.blder.bot", null)).toBeNull();
  });

  it("reads the refused status from RN's iOS and Android error messages", () => {
    expect(rejectedStatusFrom("Received bad response code from server 403.")).toBe(403);
    expect(rejectedStatusFrom("Received bad response code from server: 401.")).toBe(401);
    expect(rejectedStatusFrom("Expected HTTP 101 response but was '401 Unauthorized'")).toBe(401);
    expect(rejectedStatusFrom("The network connection was lost.")).toBeNull();
    expect(rejectedStatusFrom(undefined)).toBeNull();
  });
});
