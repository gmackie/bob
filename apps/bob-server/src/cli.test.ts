import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("parses defaults", () => {
    const args = parseArgs(["node", "bob-server"]);
    expect(args).toMatchObject({
      port: 0,
      host: "127.0.0.1",
      authToken: undefined,
      bootstrapFd: undefined,
      noBrowser: false,
      baseDir: expect.stringContaining(".bob"),
    });
  });

  it("parses explicit flags", () => {
    const args = parseArgs([
      "node",
      "bob-server",
      "--port",
      "3773",
      "--host",
      "0.0.0.0",
      "--auth-token",
      "abc123",
      "--base-dir",
      "/tmp/bob-test",
      "--no-browser",
    ]);
    expect(args).toMatchObject({
      port: 3773,
      host: "0.0.0.0",
      authToken: "abc123",
      baseDir: "/tmp/bob-test",
      noBrowser: true,
    });
  });

  it("reads --bootstrap-fd as integer", () => {
    const args = parseArgs([
      "node",
      "bob-server",
      "--bootstrap-fd",
      "3",
    ]);
    expect(args.bootstrapFd).toBe(3);
  });
});
