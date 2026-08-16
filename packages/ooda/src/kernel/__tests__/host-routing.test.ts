import { describe, expect, it, vi } from "vitest";

import {
  normalizeHostOutput,
  routeHostCompletion,
  type HostProviderClient,
} from "../host-routing";

function provider(
  id: HostProviderClient["id"],
  complete: HostProviderClient["complete"],
): HostProviderClient {
  return { id, complete };
}

describe("host routing", () => {
  it("falls back from Grok to Claude visibly without changing conversation identity", async () => {
    const grok = provider(
      "grok",
      vi.fn(() => Promise.reject(new Error("rate limited"))),
    );
    const claude = provider(
      "claude",
      vi.fn(() =>
        Promise.resolve({
          providerResponseId: "claude-response-1",
          model: "claude-opus-4-6",
          text: '{"display":"Full answer","speakable":"Short answer"}',
        }),
      ),
    );
    const openai = provider(
      "openai",
      vi.fn(() => Promise.reject(new Error("unused"))),
    );

    const result = await routeHostCompletion({
      preferredProvider: "grok",
      providers: [grok, claude, openai],
      messages: [{ role: "user", content: "Help me think" }],
      system: "OODA host",
    });

    expect(result).toMatchObject({
      provider: "claude",
      model: "claude-opus-4-6",
      output: { display: "Full answer", speakable: "Short answer" },
      fallback: {
        preferredProvider: "grok",
        failures: [{ provider: "grok", code: "PROVIDER_FAILED" }],
      },
    });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("keeps rich display text while omitting unsafe speech", () => {
    expect(normalizeHostOutput("```ts\nconst token = 'secret';\n```")).toEqual({
      display: "```ts\nconst token = 'secret';\n```",
    });
  });

  it("normalizes one explicit Bob task draft without accepting policy fields", () => {
    expect(
      normalizeHostOutput(
        JSON.stringify({
          display: "I drafted the implementation task for your review.",
          speakable: "I drafted the task for your review.",
          proposal: {
            kind: "bob_task",
            title: "Add voice barge-in telemetry",
            description: "Capture enough evidence to diagnose interrupted TTS.",
            acceptanceCriteria: [
              "Record TTS stop latency without raw audio",
              "Expose the measurement in ForgeGraph evidence",
            ],
            targetRepo: "/Volumes/dev/bob/bob",
            constraints: ["Do not retain microphone audio"],
            nonGoals: ["Changing the speech provider"],
            rationale:
              "The user explicitly asked to turn the discussion into a task.",
            confidence: 0.91,
          },
        }),
      ),
    ).toEqual({
      display: "I drafted the implementation task for your review.",
      speakable: "I drafted the task for your review.",
      proposal: {
        kind: "bob_task",
        title: "Add voice barge-in telemetry",
        description: "Capture enough evidence to diagnose interrupted TTS.",
        acceptanceCriteria: [
          "Record TTS stop latency without raw audio",
          "Expose the measurement in ForgeGraph evidence",
        ],
        targetRepo: "/Volumes/dev/bob/bob",
        constraints: ["Do not retain microphone audio"],
        nonGoals: ["Changing the speech provider"],
        rationale:
          "The user explicitly asked to turn the discussion into a task.",
        confidence: 0.91,
      },
    });
  });

  it("drops malformed or policy-bearing proposal drafts while preserving the answer", () => {
    for (const proposal of [
      {
        kind: "bob_task",
        title: "Missing acceptance criteria",
        rationale: "Incomplete",
        confidence: 0.7,
      },
      {
        kind: "bob_task",
        title: "Model attempts to choose policy",
        acceptanceCriteria: ["Never accept model policy"],
        rationale: "Unsafe",
        confidence: 0.7,
        destination: "bob",
        risk: "durable_work",
        policySnapshot: { approved: true },
      },
      {
        kind: "mobile_release",
        name: "Ship without a domain adapter review",
        acceptanceCriteria: ["Released"],
        rationale: "Out of scope",
        confidence: 0.9,
      },
    ]) {
      expect(
        normalizeHostOutput(
          JSON.stringify({ display: "The answer remains useful.", proposal }),
        ),
      ).toEqual({ display: "The answer remains useful." });
    }
  });
});
