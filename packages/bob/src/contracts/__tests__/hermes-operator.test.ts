import { describe, expect, it } from "vitest";

import {
  getHermesIntentPolicy,
  HERMES_INTENT_POLICIES,
  parseHermesOperatorIntent,
} from "../index.js";

describe("Hermes operator contract", () => {
  it("decodes a strict, replay-safe capture intent", () => {
    const input = {
      schemaVersion: 1,
      requestId: "telegram:4512:9918",
      intent: "capture",
      channel: "telegram",
      occurredAt: "2026-08-21T13:30:00.000Z",
      payload: {
        text: "Follow up with the controls team tomorrow morning.",
      },
    } as const;

    expect(parseHermesOperatorIntent(input)).toEqual(input);
    expect(() =>
      parseHermesOperatorIntent({ ...input, actorId: "spoofed-operator" }),
    ).toThrow();
    expect(() =>
      parseHermesOperatorIntent({
        ...input,
        payload: { ...input.payload, destination: "/tmp/private" },
      }),
    ).toThrow();
  });

  it.each([
    ["today", {}],
    [
      "research",
      {
        question: "Compare the three reviewed scheduling options.",
        sourceBudget: 8,
        timeBudgetMinutes: 20,
      },
    ],
    ["work", { request: "Turn the approved outline into a proposal." }],
    [
      "approve",
      {
        proposalId: "proposal-42",
        scopeDigest: `sha256:${"a".repeat(64)}`,
      },
    ],
    ["status", { query: "Where is the desktop release?" }],
    ["fleet", { query: "Which machines have MCP drift?", dryRun: true }],
    ["close", {}],
    ["stop", { reason: "Pause operator automation." }],
  ] as const)("decodes the %s intent", (intent, payload) => {
    expect(
      parseHermesOperatorIntent({
        schemaVersion: 1,
        requestId: `console:${intent}:42`,
        intent,
        channel: "console",
        occurredAt: "2026-08-21T13:30:00Z",
        payload,
      }),
    ).toMatchObject({ intent, payload });
  });

  it("assigns every intent one owner and explicit risk/effect policy", () => {
    expect(Object.keys(HERMES_INTENT_POLICIES)).toHaveLength(9);
    expect(getHermesIntentPolicy("capture", "telegram")).toMatchObject({
      owner: "ooda",
      riskClass: "R1",
      effect: "accepted-user-write",
    });
    expect(getHermesIntentPolicy("work", "telegram").effect).toBe(
      "proposal-only",
    );
    expect(getHermesIntentPolicy("fleet", "telegram").effect).toBe(
      "read-or-dry-run-proposal",
    );
    expect(getHermesIntentPolicy("approve", "telegram")).toMatchObject({
      owner: "bob",
      riskClass: "R3",
      effect: "approval-only",
    });
  });
});
