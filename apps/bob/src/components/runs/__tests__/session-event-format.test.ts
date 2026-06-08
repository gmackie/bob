import { describe, expect, it } from "vitest";

import {
  collapseSessionEventsToMessages,
  formatSessionLogArtifactText,
  formatSessionEventText,
  normalizeSessionEventRecords,
} from "../session-event-format";

describe("session event formatting", () => {
  it("extracts assistant text from JSONL stdout chunks instead of exposing JSON", () => {
    const text = formatSessionEventText("output_chunk", {
      data: [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I found the failing endpoint." }],
          },
        }),
        JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: " It is fixed now." },
        }),
      ].join("\n"),
    });

    expect(text).toBe("I found the failing endpoint. It is fixed now.");
  });

  it("extracts readable text from response output delta events", () => {
    const text = formatSessionEventText("output_chunk", {
      data: JSON.stringify({
        type: "response.output_text.delta",
        delta: "Watching the active agent output.",
      }),
    });

    expect(text).toBe("Watching the active agent output.");
  });

  it("does not render raw system JSON when no display text exists", () => {
    const text = formatSessionEventText("output_chunk", {
      data: JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session-1",
      }),
    });

    expect(text).toBe("");
  });

  it("collapses output chunks and final messages into readable chat messages", () => {
    const messages = collapseSessionEventsToMessages([
      {
        id: "evt-1",
        seq: 1,
        eventType: "output_chunk",
        direction: "agent",
        createdAt: "2026-05-31T10:00:00.000Z",
        payload: {
          data: JSON.stringify({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Reading the current queue." },
          }),
        },
      },
      {
        id: "evt-2",
        seq: 2,
        eventType: "input",
        direction: "client",
        createdAt: "2026-05-31T10:01:00.000Z",
        payload: { content: "Start the next task" },
      },
      {
        id: "evt-3",
        seq: 3,
        eventType: "message_final",
        direction: "agent",
        createdAt: "2026-05-31T10:02:00.000Z",
        payload: {
          data: {
            message: {
              content: [{ type: "text", text: "The task is now running." }],
            },
          },
        },
      },
    ]);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "Reading the current queue.",
        seq: 1,
        time: "2026-05-31T10:00:00.000Z",
      },
      {
        role: "user",
        content: "Start the next task",
        seq: 2,
        time: "2026-05-31T10:01:00.000Z",
      },
      {
        role: "assistant",
        content: "The task is now running.",
        seq: 3,
        time: "2026-05-31T10:02:00.000Z",
      },
    ]);
  });

  it("summarizes tool call arguments without exposing raw JSON", () => {
    const text = formatSessionEventText("tool_call", {
      name: "Bash",
      arguments: JSON.stringify({
        command: "pnpm test -- --runInBand",
        description: "Run focused tests",
      }),
    });

    expect(text).toBe("Bash: pnpm test -- --runInBand");
  });

  it("extracts stdout and stderr from tool results", () => {
    const text = formatSessionEventText("tool_result", {
      result: JSON.stringify({
        stdout: "2 tests passed",
        stderr: "warning: deprecated flag",
      }),
    });

    expect(text).toBe("2 tests passed\nwarning: deprecated flag");
  });

  it("formats JSONL log artifact content as readable session text", () => {
    const text = formatSessionLogArtifactText({
      content: [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "session-1",
        }),
        JSON.stringify({
          type: "response.output_text.delta",
          delta: "Reviewing the task output.",
        }),
        JSON.stringify({
          type: "tool_result",
          result: { stdout: "2 tests passed", stderr: "" },
        }),
      ].join("\n"),
      lines: 3,
    });

    expect(text).toBe("Reviewing the task output.\n2 tests passed");
    expect(text).not.toContain("session_id");
    expect(text).not.toContain("{");
  });

  it("normalizes tRPC session event responses into formatter-ready records", () => {
    expect(
      normalizeSessionEventRecords({
        events: [
          {
            id: "evt-1",
            seq: 1,
            eventType: "output_chunk",
            direction: "agent",
            payload: { data: "Readable output" },
            createdAt: new Date("2026-05-31T10:00:00.000Z"),
          },
          {
            id: "evt-skip",
            eventType: "output_chunk",
            direction: "agent",
            payload: { data: "Missing sequence" },
            createdAt: "2026-05-31T10:01:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        id: "evt-1",
        seq: 1,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "Readable output" },
        createdAt: "2026-05-31T10:00:00.000Z",
      },
    ]);

    expect(
      normalizeSessionEventRecords([
        {
          seq: 2,
          eventType: "message_final",
          direction: "agent",
          payload: { content: "Done" },
          createdAt: "2026-05-31T10:02:00.000Z",
        },
      ]),
    ).toEqual([
      {
        id: undefined,
        seq: 2,
        eventType: "message_final",
        direction: "agent",
        payload: { content: "Done" },
        createdAt: "2026-05-31T10:02:00.000Z",
      },
    ]);
  });
});
