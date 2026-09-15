import { describe, expect, it, vi } from "vitest";

import {
  completeOodaOpenAiChat,
  listOodaOpenAiModels,
  oodaOpenAiOptionsResponse,
  withOodaOpenAiCors,
  OodaOpenAiError,
  type OodaOpenAiDispatch,
} from "../openai-compat";

function dispatch(opts: {
  statuses?: string[];
  stdout?: string;
  devices?: Array<{
    id: string;
    name?: string;
    hostname?: string;
    status?: string;
    capabilities?: string[];
  }>;
}): OodaOpenAiDispatch {
  const statuses = [...(opts.statuses ?? ["completed"])];
  return {
    listDevices: async () =>
      opts.devices ?? [
        {
          id: "runner-bob",
          name: "runner-hetzner-bob",
          hostname: "hetzner-bob",
          status: "online",
          capabilities: ["claude", "codex", "grok"],
        },
      ],
    createThread: async () => ({ id: "thread-1" }),
    sendPrompt: async ({ adapterId }) => ({
      id: `session-${adapterId}`,
      status: "pending",
    }),
    listSessions: async () => [
      {
        id: "session-claude",
        status: statuses.shift() ?? "completed",
      },
    ],
    getSessionEvents: async () => [
      { type: "stdout", content: opts.stdout ?? '{"ok":true}' },
    ],
    sleep: async () => undefined,
  };
}

describe("OODA OpenAI chat completions", () => {
  it("lists Bob adapters as models", () => {
    expect(listOodaOpenAiModels().map((model) => model.id)).toEqual([
      "claude",
      "codex",
      "grok",
      "cursor-agent",
    ]);
  });

  it("dispatches to hetzner-bob and returns a chat.completion", async () => {
    const result = await completeOodaOpenAiChat(
      {
        model: "claude",
        messages: [
          { role: "system", content: "Write JSON." },
          { role: "user", content: "say ok" },
        ],
      },
      dispatch({}),
    );
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0]?.message.content).toBe('{"ok":true}');
    expect(result.model).toBe("claude");
  });

  it("rejects streaming and missing user turns", async () => {
    await expect(
      completeOodaOpenAiChat(
        {
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
        dispatch({}),
      ),
    ).rejects.toBeInstanceOf(OodaOpenAiError);

    await expect(
      completeOodaOpenAiChat({ messages: [] }, dispatch({})),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails closed when no runner is online", async () => {
    await expect(
      completeOodaOpenAiChat(
        { messages: [{ role: "user", content: "hi" }] },
        dispatch({ devices: [] }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("rotates adapters when the first returns empty stdout", async () => {
    const sendPrompt = vi.fn(async ({ adapterId }: { adapterId: string }) => ({
      id: `session-${adapterId}`,
      status: "pending" as const,
    }));
    const result = await completeOodaOpenAiChat(
      { messages: [{ role: "user", content: "hi" }] },
      {
        ...dispatch({}),
        sendPrompt,
        listSessions: async () => [
          { id: "session-claude", status: "completed" },
          { id: "session-codex", status: "completed" },
        ],
        getSessionEvents: async ({ sessionId }) => [
          {
            type: "stdout",
            content: sessionId === "session-codex" ? "from-codex" : "",
          },
        ],
      },
    );
    expect(result.choices[0]?.message.content).toBe("from-codex");
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  it("adds CORS headers so other apps can call Bob in development", () => {
    const options = oodaOpenAiOptionsResponse();
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const wrapped = withOodaOpenAiCors(Response.json({ ok: true }));
    expect(wrapped.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
  });
});
