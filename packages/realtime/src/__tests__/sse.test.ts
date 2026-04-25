import { describe, expect, it } from "vitest";
import { Stream } from "effect";

import { streamToSseResponse } from "../sse.js";

// Helper to read the full Response body as text.
async function readResponseBody(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

describe("streamToSseResponse", () => {
  it("emits 3 data lines for a 3-event stream", async () => {
    const stream = Stream.fromIterable([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const response = streamToSseResponse(stream);
    const body = await readResponseBody(response);
    expect(body).toBe(
      `data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n`,
    );
  });

  it("uses custom encode function", async () => {
    const stream = Stream.fromIterable(["a", "b"]);
    const response = streamToSseResponse(stream, (s) => `[${s}]`);
    const body = await readResponseBody(response);
    expect(body).toBe(`data: [a]\n\ndata: [b]\n\n`);
  });

  it("sets text/event-stream + cache-control + connection headers", () => {
    const stream = Stream.fromIterable<number>([]);
    const response = streamToSseResponse(stream);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });
});
