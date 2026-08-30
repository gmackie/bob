/**
 * Adapter output has to reach the credit latch, or an exhausted account stays
 * invisible.
 *
 * The latch can only classify what it is given. `runWithCli` pipes stdout and
 * stderr through `captureOutput`, but `forwardAdapterEvent` — the path every
 * ADAPTER-backed run takes — only forwarded events onward and never captured
 * them. So `noteRunOutcome` received an empty string, `classifyRunFailure`
 * saw nothing to match, and no latch was set.
 *
 * That is the original 2026-08-29 regression, still live on 2026-08-30: grok
 * failed six runs with `"http_status": 402`, `~/.bob/credit-state.json` stayed
 * `{}`, and the node page kept showing Grok "Ready" while every dispatch to it
 * burned. The earlier fix only ever covered the CLI path.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BobGatewayConnector } from "./bob-gateway.js";

let dir: string;
let connector: BobGatewayConnector;

function creditState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(process.env.BOB_CREDIT_STATE_PATH!, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adapter-capture-"));
  process.env.BOB_CREDIT_STATE_PATH = join(dir, "credit-state.json");
  connector = new BobGatewayConnector(
    {
      gatewayUrl: "ws://127.0.0.1:1/none",
      apiKey: "k",
      workspaceId: "ws",
      devDir: dir,
      maxConcurrent: 1,
    },
    new Map(),
  );
});

afterEach(() => {
  delete process.env.BOB_CREDIT_STATE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("adapter output reaches the credit latch", () => {
  it("latches no_credit from a 402 emitted as an adapter stderr event", () => {
    const c = connector as unknown as {
      forwardAdapterEvent: (id: string, e: { type: string; data: string }) => void;
      finishRunOutcome: (id: string, agent: string, code: number | null) => void;
    };

    // Exactly what grok emitted in production.
    c.forwardAdapterEvent("s1", {
      type: "stderr",
      data: '{ "http_status": 402, "error": "insufficient credit" }',
    });
    c.finishRunOutcome("s1", "grok", 1);

    expect(creditState()).toHaveProperty("grok");
  });

  it("latches from an adapter stdout event too", () => {
    const c = connector as unknown as {
      forwardAdapterEvent: (id: string, e: { type: string; data: string }) => void;
      finishRunOutcome: (id: string, agent: string, code: number | null) => void;
    };

    c.forwardAdapterEvent("s2", { type: "stdout", data: "402 Payment Required" });
    c.finishRunOutcome("s2", "grok", 1);

    expect(creditState()).toHaveProperty("grok");
  });

  it("does not latch when the adapter run succeeds", () => {
    const c = connector as unknown as {
      forwardAdapterEvent: (id: string, e: { type: string; data: string }) => void;
      finishRunOutcome: (id: string, agent: string, code: number | null) => void;
    };

    c.forwardAdapterEvent("s3", { type: "stdout", data: "all good" });
    c.finishRunOutcome("s3", "grok", 0);

    expect(creditState()).not.toHaveProperty("grok");
  });

  it("does not latch a rate limit as an exhausted balance", () => {
    const c = connector as unknown as {
      forwardAdapterEvent: (id: string, e: { type: string; data: string }) => void;
      finishRunOutcome: (id: string, agent: string, code: number | null) => void;
    };

    c.forwardAdapterEvent("s4", { type: "stderr", data: "429 Too Many Requests" });
    c.finishRunOutcome("s4", "grok", 1);

    expect(creditState()).not.toHaveProperty("grok");
  });
});
