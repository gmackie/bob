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

  it("strict mode never answers with a different adapter", async () => {
    const sendPrompt = vi.fn(async ({ adapterId }: { adapterId: string }) => ({
      id: `session-${adapterId}`,
      status: "pending" as const,
    }));
    await expect(
      completeOodaOpenAiChat(
        { model: "grok", strict: true, messages: [{ role: "user", content: "hi" }] },
        {
          ...dispatch({}),
          sendPrompt,
          listSessions: async () => [{ id: "session-grok", status: "failed" }],
        },
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(sendPrompt.mock.calls.map(([input]) => input.adapterId)).toEqual(["grok"]);
  });

  it("strict mode fails closed when the runner lacks the adapter or the model is unknown", async () => {
    const noGrok = dispatch({
      devices: [
        { id: "runner-bob", hostname: "hetzner-bob", status: "online", capabilities: ["claude"] },
      ],
    });
    await expect(
      completeOodaOpenAiChat(
        { model: "grok", strict: true, messages: [{ role: "user", content: "hi" }] },
        noGrok,
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      completeOodaOpenAiChat(
        { model: "gpt-9", strict: true, messages: [{ role: "user", content: "hi" }] },
        dispatch({}),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reports the adapter that actually answered", async () => {
    const result = await completeOodaOpenAiChat(
      { model: "grok", strict: true, messages: [{ role: "user", content: "hi" }] },
      {
        ...dispatch({}),
        listSessions: async () => [{ id: "session-grok", status: "completed" }],
      },
    );
    expect(result.adapter).toBe("grok");
  });

  it("json_object output must parse, and is asked for in the prompt", async () => {
    const sendPrompt = vi.fn(async ({ adapterId }: { adapterId: string; prompt: string }) => ({
      id: `session-${adapterId}`,
      status: "pending" as const,
    }));
    const jsonBody = {
      model: "grok",
      strict: true,
      response_format: { type: "json_object" as const },
      messages: [{ role: "user", content: "hi" }],
    };
    const ok = await completeOodaOpenAiChat(jsonBody, {
      ...dispatch({ stdout: '```json\n{"scenes":[]}\n```' }),
      sendPrompt,
      listSessions: async () => [{ id: "session-grok", status: "completed" }],
    });
    expect(JSON.parse(ok.choices[0]!.message.content)).toEqual({ scenes: [] });
    expect(sendPrompt.mock.calls[0]![0].prompt).toMatch(/single JSON object/);

    await expect(
      completeOodaOpenAiChat(jsonBody, {
        ...dispatch({ stdout: "Sure! Here is your briefing." }),
        listSessions: async () => [{ id: "session-grok", status: "completed" }],
      }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("waits long enough for a Grok council draft, but not forever", async () => {
    // A DailyDose council took Grok 270-300 s through Bob on 2026-10-15.
    let clock = 0;
    const slow = (finishAt: number): OodaOpenAiDispatch => ({
      ...dispatch({}),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      listSessions: async () => [
        { id: "session-grok", status: clock >= finishAt ? "completed" : "running" },
      ],
    });
    const body = { model: "grok", strict: true, messages: [{ role: "user", content: "hi" }] };

    const done = await completeOodaOpenAiChat(body, slow(300_000));
    expect(done.adapter).toBe("grok");

    clock = 0;
    await expect(completeOodaOpenAiChat(body, slow(Infinity))).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/timed out/),
    });
    expect(clock).toBeLessThan(610_000);
  });

  it("adds CORS headers so other apps can call Bob in development", () => {
    const options = oodaOpenAiOptionsResponse();
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const wrapped = withOodaOpenAiCors(Response.json({ ok: true }));
    expect(wrapped.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
  });
});
