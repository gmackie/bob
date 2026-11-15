import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeAnswers, type CiMessage, type ItemSnapshot, type PendingInput, type TailFrame } from "@bob/sdlc-view";

import { AnswerForm } from "./attempt-answer";
import {
  answerablePending,
  draftAnswers,
  emptyAttempt,
  emptyDraft,
  MAX_ATTEMPT_ITEMS,
  parseAttemptMessage,
  reduceAttempt,
  resolveInputCommand,
  setText,
  tailLines,
  tailView,
  toggleOption,
  type AttemptState,
} from "./attempt-model";
import { AttemptView } from "./attempt-view";
import { answerFormStatus, emptyCommands, type ActionContext } from "./commands-model";
import { createEdgeClient } from "./edge-client";

const pending: PendingInput = {
  attemptId: "att-1", promptId: "prompt-1", kind: "user_input", createdAt: "2026-11-15T12:00:00Z",
  questions: [
    { id: "q-db", header: "Database", question: "Which database?", options: [{ label: "Postgres", value: "pg" }, { label: "SQLite" }], multiSelect: false },
    { id: "q-env", question: "Which environments?", options: [{ label: "Beta", value: "beta" }, { label: "Prod", value: "prod" }], multiSelect: true },
    { id: "q-why", question: "Anything else?", options: [], multiSelect: false },
  ],
};
const execution = { attemptId: "att-1", target: { environmentId: "e", projectId: "p", repository: { integrationId: "forgegraph", repositoryId: "bob" } }, thread: { environmentId: "env-1", projectId: "proj-1", threadId: "thr-9" } };
const item = (state: ItemSnapshot["state"] = "waiting-input", extra: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  itemId: "item-a", planId: "plan-1", resourceVersion: 2, state, currentAttemptId: "att-1", execution, pendingInput: pending,
  achievedMilestones: [], operationIds: [], evidenceRefs: [], ...extra,
});
const frame = (lines: string[], at = "2026-11-15T12:00:01Z", extra: Partial<TailFrame> = {}): TailFrame =>
  ({ itemId: "item-a", attemptId: "att-1", threadId: "thr-9", lines, threadStatus: "running", at, ...extra });
const ci = (patch: Partial<Extract<CiMessage, { available: true }>> = {}): CiMessage => ({
  type: "ci", itemId: "item-a", available: true, sha: "abcdef0123456789", summary: "2 of 3 passed", at: "t",
  phases: [{ name: "lint", status: "passed" }, { name: "test", status: "running", url: "https://ci.example/run/1" }, { name: "deploy", status: "queued", url: "javascript:alert(1)" }],
  ...patch,
});
const live = (patch: Partial<ActionContext> = {}): ActionContext => ({ connection: "live", banner: null, hasView: true, commands: emptyCommands(), ...patch });

function harness() {
  const sent: Array<Record<string, unknown>> = [];
  let n = 0;
  const attempts: AttemptState[] = [];
  const client = createEdgeClient({ send: (d) => sent.push(JSON.parse(d)), newCommandId: () => `c${++n}`, onAttempt: (a) => attempts.push(a) });
  return { client, sent, attempts };
}

describe("watch", () => {
  it("sends watch on select and null on deselect, once per change", () => {
    const h = harness();
    h.client.opened();
    h.client.watch("item-a");
    h.client.watch("item-a");
    h.client.watch(null);
    h.client.watch(null);
    expect(h.sent.slice(1)).toEqual([{ type: "watch", itemId: "item-a" }, { type: "watch", itemId: null }]);
  });

  it("re-sends the current watch after the hello on a new socket, and nothing when unwatched", () => {
    const h = harness();
    h.client.opened();
    h.client.watch("item-a");
    h.client.opened(); // reconnect
    expect(h.sent).toEqual([
      { type: "hello", cursor: null, epoch: null },
      { type: "watch", itemId: "item-a" },
      { type: "hello", cursor: null, epoch: null },
      { type: "watch", itemId: "item-a" },
    ]);
    h.client.watch(null);
    h.sent.length = 0;
    h.client.opened();
    expect(h.sent).toEqual([{ type: "hello", cursor: null, epoch: null }]);
  });

  it("routes attempt messages into attempt state, not the view", () => {
    const h = harness();
    h.client.opened();
    const before = h.client.view;
    expect(h.client.received(JSON.stringify({ type: "tail", frame: frame(["a", "b"]) }))).toBe(true);
    expect(h.client.received(JSON.stringify(ci()))).toBe(true);
    expect(h.client.view).toBe(before);
    expect(h.client.attempt.tails["item-a"]?.lines).toEqual(["a", "b"]);
    expect(h.client.attempt.ci["item-a"]).toMatchObject({ summary: "2 of 3 passed" });
    expect(h.attempts).toHaveLength(2);
  });
});

describe("attempt state", () => {
  it("parses only well-formed attempt messages", () => {
    expect(parseAttemptMessage(JSON.stringify({ type: "tail", frame: frame(["x"]) }))).not.toBeNull();
    expect(parseAttemptMessage(JSON.stringify({ type: "tail", frame: { ...frame([]), lines: [1] } }))).toBeNull();
    expect(parseAttemptMessage(JSON.stringify({ type: "ci", itemId: "i", available: false }))).toBeNull();
    expect(parseAttemptMessage(JSON.stringify({ type: "ci", itemId: "i", available: false, reason: "down", at: "t" }))).not.toBeNull();
    expect(parseAttemptMessage(JSON.stringify({ type: "tailUnavailable", itemId: "i", reason: "r" }))).not.toBeNull();
    expect(parseAttemptMessage(JSON.stringify({ type: "snapshot" }))).toBeNull();
    expect(parseAttemptMessage("nope")).toBeNull();
  });

  it("keeps the latest tail per item, ignores an older frame of the same attempt, and clears unavailable", () => {
    let s = reduceAttempt(emptyAttempt(), { type: "tailUnavailable", itemId: "item-a", reason: "relay silent" });
    expect(tailView(s, item())).toEqual({ kind: "unavailable", reason: "relay silent", frame: null });
    s = reduceAttempt(s, { type: "tail", frame: frame(["new"], "2026-11-15T12:00:05Z") });
    s = reduceAttempt(s, { type: "tail", frame: frame(["old"], "2026-11-15T12:00:01Z") });
    expect(tailView(s, item())).toMatchObject({ kind: "live", frame: { lines: ["new"] } });
    s = reduceAttempt(s, { type: "tailUnavailable", itemId: "item-a", reason: "gone" });
    expect(tailView(s, item())).toMatchObject({ kind: "unavailable", frame: { lines: ["new"] } });
  });

  it("ignores a tail from an earlier attempt, and bounds how many items are kept", () => {
    const s = reduceAttempt(emptyAttempt(), { type: "tail", frame: frame(["x"], "t", { attemptId: "att-0" }) });
    expect(tailView(s, item()).kind).toBe("waiting");
    let many = emptyAttempt();
    for (let i = 0; i < MAX_ATTEMPT_ITEMS + 5; i++) many = reduceAttempt(many, { type: "tail", frame: frame(["x"], "t", { itemId: `i${i}` }) });
    expect(Object.keys(many.tails)).toHaveLength(MAX_ATTEMPT_ITEMS);
    expect(many.tails[`i${MAX_ATTEMPT_ITEMS + 4}`]).toBeDefined();
  });

  it("shows at most the last 40 lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `l${i}`);
    expect(tailLines(frame(lines))).toHaveLength(40);
    expect(tailLines(frame(lines)).at(0)).toBe("l10");
    expect(tailLines(frame(lines), 3)).toEqual(["l47", "l48", "l49"]);
  });
});

describe("answer form model", () => {
  it("is answerable only while waiting for input with questions", () => {
    expect(answerablePending(item())).toBe(pending);
    expect(answerablePending(item("running"))).toBeNull();
    expect(answerablePending(item("waiting-input", { pendingInput: null }))).toBeNull();
  });

  it("builds Answers that decodeAnswers accepts: value ?? label, arrays only for multiSelect, trimmed free text", () => {
    const [db, env, why] = pending.questions as [typeof pending.questions[0], typeof pending.questions[0], typeof pending.questions[0]];
    let d = emptyDraft(pending);
    expect(draftAnswers(pending, d)).toEqual({ answers: null, errors: { "q-db": "Pick an option.", "q-env": "Pick at least one option.", "q-why": "Write an answer." } });
    d = toggleOption(d, db, "pg");
    d = toggleOption(d, db, "SQLite"); // single: replaces
    d = toggleOption(d, env, "beta");
    d = toggleOption(d, env, "prod");
    d = toggleOption(d, env, "beta"); // multi: toggles off
    d = setText(d, why, "  ship it  ");
    const { answers, errors } = draftAnswers(pending, d);
    expect(errors).toEqual({});
    expect(answers).toEqual({ "q-db": "SQLite", "q-env": ["prod"], "q-why": "ship it" });
    const command = resolveInputCommand("item-a", pending, answers!);
    expect(command).toEqual({ operation: "ResolveInput", input: { itemId: "item-a", attemptId: "att-1", promptId: "prompt-1", answer: JSON.stringify(answers) } });
    expect(command.operation === "ResolveInput" && decodeAnswers(command.input.answer, pending)).toEqual(answers);
  });

  it("refuses over-long free text and options that are not offered", () => {
    const why = pending.questions[2]!;
    const db = pending.questions[0]!;
    let d = setText(emptyDraft(pending), why, "x".repeat(4001));
    d = { ...d, [db.id]: { selected: ["mysql"], text: "" } };
    expect(draftAnswers(pending, d).errors).toMatchObject({ "q-db": "Pick an option.", "q-why": expect.stringContaining("4000") });
  });

  it("disables while offline or while a command for the item is in flight, and shows the answer's lifecycle", () => {
    expect(answerFormStatus(live({ connection: "reconnecting" }), "item-a")).toMatchObject({ disabled: true, reason: "Not connected to the SDLC edge." });
    const h = harness();
    h.client.opened();
    const id = h.client.send(resolveInputCommand("item-a", pending, { "q-db": "pg", "q-env": ["beta"], "q-why": "ok" }), "Answer");
    expect(h.sent.at(-1)).toMatchObject({ type: "command", operation: "ResolveInput" });
    expect(h.sent.at(-1)).not.toHaveProperty("confirm");
    let status = answerFormStatus(live({ commands: h.client.commands }), "item-a");
    expect(status).toMatchObject({ disabled: true, pending: true, text: "Answer: sending…" });
    h.client.received(JSON.stringify({ type: "commandResult", commandId: id, ok: true, operation: { contractVersion: "1", operationId: "o", commandId: id, state: "succeeded", resourceId: "item-a", resourceVersion: 3 } }));
    status = answerFormStatus(live({ commands: h.client.commands }), "item-a");
    expect(status).toMatchObject({ disabled: false, pending: false, text: "Answer: succeeded (now v3)" });
  });
});

describe("components", () => {
  const attempt = (patch: Partial<AttemptState> = {}): AttemptState => ({ ...emptyAttempt(), ...patch });

  it("AttemptView shows the thread ids, the live tail and CI phases, with unsafe CI links as text", () => {
    const html = renderToStaticMarkup(<AttemptView item={item("running")} attempt={attempt({ tails: { "item-a": frame(["$ pnpm test", "ok 12"]) }, ci: { "item-a": ci() } })} />);
    expect(html).toContain("env-1 / proj-1 / thr-9");
    expect(html).toContain("● live");
    expect(html).toContain("$ pnpm test\nok 12");
    expect(html).toContain("2 of 3 passed");
    expect(html).toContain('href="https://ci.example/run/1"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('data-status="queued"');
  });

  it("AttemptView says when live detail and CI are unavailable", () => {
    const html = renderToStaticMarkup(<AttemptView item={item("running")} attempt={attempt({
      unavailable: { "item-a": "the relay has not posted recently" },
      ci: { "item-a": { type: "ci", itemId: "item-a", available: false, reason: "ForgeGraph is down", at: "t" } },
    })} />);
    expect(html).toContain("Live detail unavailable: the relay has not posted recently");
    expect(html).toContain("CI detail unavailable: ForgeGraph is down");
    expect(renderToStaticMarkup(<AttemptView item={item("running", { execution: null })} attempt={attempt()} />)).toBe("");
  });

  it("AnswerForm draws radios, checkboxes and a text box, and disables while a command is in flight", () => {
    const html = renderToStaticMarkup(<AnswerForm itemId="item-a" pending={pending} context={live()} send={() => null} />);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('value="pg"');
    expect(html).toContain('value="SQLite"');
    expect(html).toContain("<textarea");
    expect(html).not.toContain("disabled=\"\"");
    const busy = renderToStaticMarkup(<AnswerForm itemId="item-a" pending={pending} context={live({ connection: "reconnecting" })} send={() => null} />);
    expect(busy).toContain("disabled=\"\"");
    expect(busy).toContain("Not connected to the SDLC edge.");
  });
});
