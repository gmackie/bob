import { describe, expect, it } from "vitest";
import { decodeAnswers } from "@bob/sdlc-view";

import { FIXTURE_PENDING, fixtureView, PLAN_PAUSED } from "../fixtures";
import {
  answerablePending,
  asAttemptMessage,
  draftAnswers,
  emptyAttempt,
  emptyDraft,
  flowKey,
  reduceAttempt,
  resolveInputOption,
  setText,
  startFlow,
  tailLines,
  tailView,
  toggleOption,
  type AnswerFlow,
  type FlowKey,
  type FlowResult,
} from "./attempt";
import { emptyCommands, recordSent, clientCommand } from "./commands";
import { handleKey, initialUi, type KeyContext } from "./keymap";

const view = fixtureView();
const p1 = view.items["item-p1"]!;
const [db, env, note] = FIXTURE_PENDING.questions as [typeof FIXTURE_PENDING.questions[0], typeof FIXTURE_PENDING.questions[0], typeof FIXTURE_PENDING.questions[0]];
const frame = (lines: string[], at: string, attemptId = "att-p1") => ({ itemId: "item-p1", attemptId, threadId: "thr-12", lines, threadStatus: "running", at });

function keys(flow: AnswerFlow, ...presses: Array<string | FlowKey>): FlowResult {
  let result: FlowResult = { kind: "continue", flow };
  for (const p of presses) {
    if (result.kind !== "continue") break;
    result = typeof p === "string" ? flowKey(result.flow, p, {}) : flowKey(result.flow, "", p);
  }
  return result;
}
const enter: FlowKey = { return: true };

describe("attempt state", () => {
  it("validates attempt messages", () => {
    expect(asAttemptMessage({ type: "tail", frame: frame(["x"], "t") })).not.toBeNull();
    expect(asAttemptMessage({ type: "tail", frame: { ...frame([], "t"), threadId: 3 } })).toBeNull();
    expect(asAttemptMessage({ type: "ci", itemId: "i", available: true })).toBeNull();
    expect(asAttemptMessage({ type: "tailUnavailable", itemId: "i", reason: "r" })).not.toBeNull();
    expect(asAttemptMessage({ type: "commandAccepted", commandId: "c" })).toBeNull();
  });

  it("keeps the newest tail per item, marks unavailable and clears it on the next frame", () => {
    let s = reduceAttempt(emptyAttempt(), { type: "tail", frame: frame(["new"], "2") });
    s = reduceAttempt(s, { type: "tail", frame: frame(["old"], "1") });
    expect(tailView(s, p1)).toMatchObject({ kind: "live", frame: { lines: ["new"] } });
    s = reduceAttempt(s, { type: "tailUnavailable", itemId: "item-p1", reason: "silent" });
    expect(tailView(s, p1)).toMatchObject({ kind: "unavailable", reason: "silent", frame: { lines: ["new"] } });
    s = reduceAttempt(s, { type: "tail", frame: frame(["next"], "3") });
    expect(tailView(s, p1).kind).toBe("live");
    expect(tailView(reduceAttempt(emptyAttempt(), { type: "tail", frame: frame(["x"], "1", "att-old") }), p1).kind).toBe("waiting");
  });

  it("tailLines keeps the last n lines, capped at 40", () => {
    const f = frame(Array.from({ length: 45 }, (_, i) => `${i}`), "1");
    expect(tailLines(f, 2)).toEqual(["43", "44"]);
    expect(tailLines(f, 100)).toHaveLength(40);
    expect(tailLines(null, 5)).toEqual([]);
  });
});

describe("answer model", () => {
  it("only answers waiting-input items with questions", () => {
    expect(answerablePending(p1)).toBe(FIXTURE_PENDING);
    expect(answerablePending(view.items["item-a1"])).toBeNull();
    expect(answerablePending({ ...p1, pendingInput: { ...FIXTURE_PENDING, questions: [] } })).toBeNull();
  });

  it("drafts become Answers decodeAnswers accepts", () => {
    let d = toggleOption(emptyDraft(FIXTURE_PENDING), db, "pg");
    d = toggleOption(toggleOption(d, env, "beta"), env, "prod");
    expect(draftAnswers(FIXTURE_PENDING, d)).toEqual({ answers: null, error: "Anything the agent should know?: Type an answer." });
    d = setText(d, note, " hi ");
    const { answers } = draftAnswers(FIXTURE_PENDING, d);
    expect(answers).toEqual({ "q-db": "pg", "q-env": ["beta", "prod"], "q-note": "hi" });
    const option = resolveInputOption("item-p1", FIXTURE_PENDING, answers!);
    expect(option.tier).toBe(1);
    expect(option.command.operation === "ResolveInput" && decodeAnswers(option.command.input.answer, FIXTURE_PENDING)).toEqual(answers);
  });
});

describe("answer flow", () => {
  const flow = startFlow("item-p1", "FORGE-12", FIXTURE_PENDING);

  it("single choice: enter takes the highlighted option; digits pick directly", () => {
    let r = keys(flow, "j", enter);
    expect(r).toMatchObject({ kind: "continue", flow: { step: 1, draft: { "q-db": { selected: ["SQLite"] } } } });
    r = keys(flow, "2", "1");
    expect(r.kind === "continue" && r.flow.draft["q-db"]!.selected).toEqual(["pg"]);
  });

  it("multiSelect: space toggles, enter needs at least one", () => {
    const atEnv = (keys(flow, enter) as Extract<FlowResult, { kind: "continue" }>).flow;
    expect(keys(atEnv, enter)).toMatchObject({ kind: "continue", flow: { step: 1, error: expect.stringContaining("at least one") } });
    const r = keys(atEnv, " ", "j", " ", "k", " ");
    expect(r.kind === "continue" && r.flow.draft["q-env"]!.selected).toEqual(["prod"]);
  });

  it("free text: types, backspaces, refuses empty, and submits on the last question", () => {
    const atNote = (keys(flow, enter, " ", enter) as Extract<FlowResult, { kind: "continue" }>).flow;
    expect(atNote.step).toBe(2);
    expect(keys(atNote, enter)).toMatchObject({ kind: "continue", flow: { error: "Type an answer." } });
    const r = keys(atNote, "o", "k", "x", { backspace: true }, enter);
    expect(r).toEqual({ kind: "submit", flow: expect.objectContaining({ step: 2 }), answers: { "q-db": "pg", "q-env": ["beta"], "q-note": "ok" } });
  });

  it("shift-tab goes back a question and esc cancels", () => {
    const atEnv = (keys(flow, enter) as Extract<FlowResult, { kind: "continue" }>).flow;
    expect(keys(atEnv, { tab: true, shift: true })).toMatchObject({ kind: "continue", flow: { step: 0 } });
    expect(keys(atEnv, { escape: true })).toEqual({ kind: "cancel" });
  });
});

describe("a key", () => {
  const forge = { startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph", planId: PLAN_PAUSED, itemId: "item-p1" };
  const ctx = (patch: Partial<KeyContext> = {}): KeyContext => ({ view, commands: emptyCommands(), blocked: null, ...patch });

  it("opens the flow on a waiting-input item and refuses elsewhere", () => {
    const ui = { ...initialUi(), path: forge };
    expect(handleKey(ui, "a", {}, ctx()).ui.mode).toMatchObject({ kind: "answer", flow: { itemId: "item-p1", target: "FORGE-12" } });
    expect(handleKey({ ...ui, path: { ...forge, itemId: "item-p2" } }, "a", {}, ctx()).ui.message).toBe("Nothing is waiting for input here.");
    expect(handleKey(ui, "a", {}, ctx({ blocked: "the coordinator is offline" })).ui.message).toContain("the coordinator is offline");
  });

  it("refuses to submit when blocked, and when the prompt has changed", () => {
    const answering = { ...initialUi(), path: forge, mode: { kind: "answer" as const, flow: { ...startFlow("item-p1", "FORGE-12", FIXTURE_PENDING), step: 2, draft: { "q-db": { selected: ["pg"], text: "" }, "q-env": { selected: ["beta"], text: "" }, "q-note": { selected: [], text: "go" } } } } };
    const blocked = handleKey(answering, "", { return: true }, ctx({ blocked: "not connected to the SDLC edge" }));
    expect(blocked.effects).toEqual([]);
    expect(blocked.ui.mode.kind === "answer" && blocked.ui.mode.flow.error).toContain("not connected");
    const moved = { ...view, items: { ...view.items, "item-p1": { ...p1, pendingInput: { ...FIXTURE_PENDING, promptId: "prompt-2" } } } };
    expect(handleKey(answering, "", { return: true }, ctx({ view: moved })).ui.message).toContain("no longer pending");
    const inflight = recordSent(emptyCommands(), clientCommand("c1", resolveInputOption("item-p1", FIXTURE_PENDING, { "q-db": "pg" })), "Answer FORGE-12", 0);
    expect(handleKey(answering, "", { return: true }, ctx({ commands: inflight })).effects).toEqual([]);
    const ok = handleKey(answering, "", { return: true }, ctx());
    expect(ok.effects).toEqual([{ type: "send", label: "Answer FORGE-12", option: expect.objectContaining({ tier: 1, command: expect.objectContaining({ operation: "ResolveInput" }) }) }]);
    expect(ok.ui.mode.kind).toBe("browse");
  });
});
