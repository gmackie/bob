import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { NodeEnv, Port, PostgresUrl, RealtimeBackend } from "../env.js";

describe("@gmacko/config/env NodeEnv", () => {
  it("accepts 'development', 'test', and 'production'", () => {
    expect(Schema.decodeUnknownSync(NodeEnv)("development")).toBe("development");
    expect(Schema.decodeUnknownSync(NodeEnv)("test")).toBe("test");
    expect(Schema.decodeUnknownSync(NodeEnv)("production")).toBe("production");
  });

  it("rejects 'staging'", () => {
    expect(() => Schema.decodeUnknownSync(NodeEnv)("staging")).toThrow();
  });
});

describe("@gmacko/config/env PostgresUrl", () => {
  it("accepts a postgres:// URL", () => {
    const url = "postgres://user:pass@localhost:5432/db";
    expect(Schema.decodeUnknownSync(PostgresUrl)(url)).toBe(url);
  });

  it("accepts postgresql:// scheme (long form)", () => {
    const url = "postgresql://user:pass@localhost:5432/db";
    expect(Schema.decodeUnknownSync(PostgresUrl)(url)).toBe(url);
  });

  it("rejects an http:// URL", () => {
    expect(() =>
      Schema.decodeUnknownSync(PostgresUrl)("http://example.com"),
    ).toThrow();
  });
});

describe("@gmacko/config/env Port", () => {
  it("decodes '3000' to the number 3000", () => {
    expect(Schema.decodeUnknownSync(Port)("3000")).toBe(3000);
  });

  it("rejects '99999' (out of 1-65535 range)", () => {
    expect(() => Schema.decodeUnknownSync(Port)("99999")).toThrow();
  });

  it("rejects 'abc' (not a number)", () => {
    expect(() => Schema.decodeUnknownSync(Port)("abc")).toThrow();
  });
});

describe("@gmacko/config/env RealtimeBackend", () => {
  it("accepts 'memory', 'redis', and 'ws-gateway'", () => {
    expect(Schema.decodeUnknownSync(RealtimeBackend)("memory")).toBe("memory");
    expect(Schema.decodeUnknownSync(RealtimeBackend)("redis")).toBe("redis");
    expect(Schema.decodeUnknownSync(RealtimeBackend)("ws-gateway")).toBe(
      "ws-gateway",
    );
  });

  it("rejects 'kafka', empty string, and undefined", () => {
    expect(() => Schema.decodeUnknownSync(RealtimeBackend)("kafka")).toThrow();
    expect(() => Schema.decodeUnknownSync(RealtimeBackend)("")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RealtimeBackend)(undefined),
    ).toThrow();
  });
});
