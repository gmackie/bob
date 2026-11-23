import { decodeAnswers, tierOf } from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { answersFrom, displayPending, emptyDraft, resolveCommand, setText, toggleOption, unansweredCount } from "./answer-model";
import { must, PENDING } from "./test-fixtures";

const [single, multi] = PENDING.questions as [typeof PENDING.questions[0], typeof PENDING.questions[0]];

describe("answer model", () => {
  it("starts with every question unanswered and no command", () => {
    const draft = emptyDraft(PENDING);
    expect(unansweredCount(PENDING, draft)).toBe(3);
    expect(resolveCommand("item-1", PENDING, draft)).toBeNull();
  });

  it("single select replaces, and tapping the chosen option clears it; values fall back to labels", () => {
    let draft = toggleOption(emptyDraft(PENDING), single, "pg");
    draft = toggleOption(draft, single, "SQLite");
    expect(draft.q1?.selected).toEqual(["SQLite"]);
    draft = toggleOption(draft, single, "SQLite");
    expect(draft.q1?.selected).toEqual([]);
  });

  it("multi select toggles each option", () => {
    let draft = toggleOption(emptyDraft(PENDING), multi, "web");
    draft = toggleOption(draft, multi, "mobile");
    draft = toggleOption(draft, multi, "web");
    expect(draft.q2?.selected).toEqual(["mobile"]);
  });

  it("free text must be non-blank and is trimmed", () => {
    let draft = toggleOption(emptyDraft(PENDING), single, "pg");
    draft = toggleOption(draft, multi, "web");
    draft = setText(draft, "q3", "   ");
    expect(answersFrom(PENDING, draft)).toBeNull();
    expect(unansweredCount(PENDING, draft)).toBe(1);
    draft = setText(draft, "q3", "  ship it ");
    expect(answersFrom(PENDING, draft)).toEqual({ q1: "pg", q2: ["web"], q3: "ship it" });
  });

  it("builds a tier 1 ResolveInput whose answer the coordinator's decoder accepts", () => {
    let draft = toggleOption(emptyDraft(PENDING), single, "pg");
    draft = toggleOption(draft, multi, "mobile");
    draft = setText(draft, "q3", "no");
    const command = must(resolveCommand("item-1", PENDING, draft));
    expect(command).toMatchObject({ operation: "ResolveInput", input: { itemId: "item-1", attemptId: "att-1", promptId: "prompt-1" } });
    expect(tierOf(command)).toBe(1);
    if (command.operation !== "ResolveInput") throw new Error("unreachable");
    expect(decodeAnswers(command.input.answer, PENDING)).toEqual({ q1: "pg", q2: ["mobile"], q3: "no" });
  });

  it("refuses over-long free text", () => {
    let draft = toggleOption(emptyDraft(PENDING), single, "pg");
    draft = toggleOption(draft, multi, "web");
    draft = setText(draft, "q3", "x".repeat(4001));
    expect(answersFrom(PENDING, draft)).toBeNull();
  });

  it("answers an option question only with one of its option values (value ?? label), as the edge requires", () => {
    // A label whose option has a value is not an answer; nor is a stale or made-up value.
    for (const wrong of ["Postgres", "mysql"]) {
      let draft = toggleOption(emptyDraft(PENDING), single, wrong);
      draft = toggleOption(draft, multi, "web");
      draft = setText(draft, "q3", "ok");
      expect(answersFrom(PENDING, draft)).toBeNull();
      expect(resolveCommand("item-1", PENDING, draft)).toBeNull();
    }
    let draft = toggleOption(emptyDraft(PENDING), single, "SQLite");
    draft = toggleOption(draft, multi, "web");
    draft = toggleOption(draft, multi, "desktop");
    draft = setText(draft, "q3", "ok");
    expect(answersFrom(PENDING, draft)).toBeNull();
    draft = toggleOption(draft, multi, "desktop");
    expect(answersFrom(PENDING, draft)).toEqual({ q1: "SQLite", q2: ["web"], q3: "ok" });
    expect(decodeAnswers(JSON.stringify({ q1: "Postgres", q2: ["web"], q3: "ok" }), PENDING)).toBeNull();
  });

  it("shows prompt text without terminal controls but keeps option values exact", () => {
    const hostile = {
      ...PENDING,
      questions: [{ id: "q1", header: "\u001b[1mDB\u001b[0m", question: "Which\u0007 database?\r\nPick one", options: [{ label: "\u001b]8;;http://x\u0007Postgres", value: "pg\u001b" }], multiSelect: false }],
    };
    const [shown] = displayPending(hostile).questions;
    expect(shown).toMatchObject({ header: "DB", question: "Which database?\nPick one", options: [{ label: "Postgres", value: "pg\u001b" }] });
  });
});
