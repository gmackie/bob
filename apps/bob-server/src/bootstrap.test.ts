import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { readBootstrapEnvelope } from "./bootstrap.js";

describe("readBootstrapEnvelope", () => {
  it("reads a JSON envelope from a stream", async () => {
    const envelope = JSON.stringify({ authToken: "from-fd" });
    const stream = Readable.from([Buffer.from(envelope)]);
    const result = await readBootstrapEnvelope(stream);
    expect(result).toEqual({ authToken: "from-fd" });
  });

  it("returns an empty object when the stream is empty", async () => {
    const stream = Readable.from([]);
    const result = await readBootstrapEnvelope(stream);
    expect(result).toEqual({});
  });

  it("handles chunked utf-8 payloads", async () => {
    const envelope = JSON.stringify({ authToken: "abc" });
    const half = Math.floor(envelope.length / 2);
    const stream = Readable.from([
      Buffer.from(envelope.slice(0, half)),
      Buffer.from(envelope.slice(half)),
    ]);
    const result = await readBootstrapEnvelope(stream);
    expect(result).toEqual({ authToken: "abc" });
  });

  it("throws on malformed JSON", async () => {
    const stream = Readable.from([Buffer.from("{not json")]);
    await expect(readBootstrapEnvelope(stream)).rejects.toThrow();
  });
});
