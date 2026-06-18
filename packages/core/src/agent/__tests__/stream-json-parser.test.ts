import { describe, it, expect } from "vitest";

import {
  parseStreamJsonLine,
  StreamJsonBuffer,
} from "../stream-json-parser.js";

describe("parseStreamJsonLine", () => {
  it("maps system/init to session_init", () => {
    const line =
      '{"type":"system/init","session_id":"abc","model":"sonnet"}';
    expect(parseStreamJsonLine(line)).toEqual({
      type: "session_init",
      externalSessionId: "abc",
      model: "sonnet",
    });
  });

  it("maps stream_event text_delta to text_delta", () => {
    const line =
      '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}';
    expect(parseStreamJsonLine(line)).toEqual({
      type: "text_delta",
      text: "Hi",
    });
  });

  it("maps stream_event tool_use and preserves input shape", () => {
    const line =
      '{"type":"stream_event","event":{"delta":{"type":"tool_use","id":"t1","name":"Read","input":{"path":"/a"}}}}';
    expect(parseStreamJsonLine(line)).toEqual({
      type: "tool_use",
      id: "t1",
      name: "Read",
      input: { path: "/a" },
    });
  });

  it("maps stream_event tool_result with is_error true to isError true", () => {
    const line =
      '{"type":"stream_event","event":{"delta":{"type":"tool_result","tool_use_id":"t1","content":"boom","is_error":true}}}';
    const evt = parseStreamJsonLine(line);
    expect(evt).toEqual({
      type: "tool_result",
      toolUseId: "t1",
      content: "boom",
      isError: true,
    });
    // Explicitly verify the boolean cast on the isError field.
    expect(evt && evt.type === "tool_result" && evt.isError).toBe(true);
  });

  it("maps turn_end to turn_end with stopReason", () => {
    const line = '{"type":"turn_end","stop_reason":"end_turn"}';
    expect(parseStreamJsonLine(line)).toEqual({
      type: "turn_end",
      stopReason: "end_turn",
    });
  });

  it("returns null for malformed JSON and empty lines", () => {
    expect(parseStreamJsonLine("not-json")).toBeNull();
    expect(parseStreamJsonLine("")).toBeNull();
  });
});

describe("StreamJsonBuffer", () => {
  it("accumulates partial lines and emits events when newlines arrive", () => {
    const buf = new StreamJsonBuffer();
    expect(buf.push('{"type":"turn_star')).toEqual([]);
    expect(
      buf.push('t"}\n{"type":"turn_end","stop_reason":"ok"}\n'),
    ).toEqual([
      { type: "turn_start" },
      { type: "turn_end", stopReason: "ok" },
    ]);
    expect(buf.flush()).toEqual([]);
  });
});
