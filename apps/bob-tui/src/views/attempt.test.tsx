import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ItemSnapshot, PendingInput } from "@bob/sdlc-view";

import { emptyAttempt, startFlow, type AttemptState } from "../model/attempt";
import { clean, cleanBlock } from "../ui/sanitize";
import { AnswerPrompt, AttemptPane } from "./attempt";

// Ink's own styling is SGR only (ESC [ ... m). Anything else came from the data.
// eslint-disable-next-line no-control-regex
const foreign = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").match(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g);

const ESC = "\u001b";
const evil = `${ESC}]0;pwned${ESC}\\${ESC}[2J${ESC}]8;;https://evil.test\u0007`;

describe("clean", () => {
  it("removes whole escape sequences and control characters; tabs and breaks become spaces", () => {
    expect(clean(`a${evil}b\tc\r\nd\u009b1me`)).toBe("ab  c de");
    expect(cleanBlock(`a${ESC}[31m\nb`)).toBe("a\nb");
    expect(clean(undefined)).toBe("");
  });
});

describe("attempt views render agent-controlled text without terminal controls", () => {
  const item = {
    itemId: "i1", planId: "p1", resourceVersion: 3, state: "waiting-input", currentAttemptId: "a1",
    execution: { attemptId: "a1", target: { environmentId: "e", projectId: "p", repository: { integrationId: "fg", repositoryId: "r" } }, thread: { environmentId: "e", projectId: "p", threadId: "t1" } },
    achievedMilestones: [], operationIds: [], evidenceRefs: [],
  } as unknown as ItemSnapshot;
  const attempt: AttemptState = {
    ...emptyAttempt(),
    tails: { i1: { itemId: "i1", attemptId: "a1", threadId: "t1", threadStatus: `running${ESC}[5m`, at: "2026-11-15T12:00:00Z", lines: [`hello${evil}world`, "\ttabbed"] } },
    ci: { i1: { type: "ci", itemId: "i1", available: true, sha: "abcdef1234", summary: `ok${evil}`, at: "x", phases: [{ name: `lint${evil}`, status: "passed" }] } },
  };

  it("AttemptPane: tail lines, thread status and CI phases", () => {
    const out = render(<AttemptPane item={item} attempt={attempt} maxTail={10} />).lastFrame() ?? "";
    expect(out).toContain("helloworld");
    expect(out).toContain("lint");
    expect(out).not.toContain("pwned");
    expect(foreign(out)).toBeNull();
  });

  it("AnswerPrompt: header, question, option labels and descriptions", () => {
    const pending: PendingInput = {
      attemptId: "a1", promptId: "r1", kind: "user_input", createdAt: "2026-11-15T12:00:00Z",
      questions: [{ id: "q", header: `Head${evil}`, question: `Line one${ESC}[2K\nLine two\u0007`, options: [{ label: `Opt${evil}A`, description: `desc${ESC}[31m` }], multiSelect: false }],
    };
    const out = render(<AnswerPrompt flow={startFlow("i1", `BOB-1${evil}`, pending)} />).lastFrame() ?? "";
    expect(out).toContain("Head");
    expect(out).toContain("Line one");
    expect(out).toContain("OptA");
    expect(out).not.toContain("pwned");
    expect(foreign(out)).toBeNull();
  });
});
