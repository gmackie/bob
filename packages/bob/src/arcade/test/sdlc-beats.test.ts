import { describe, expect, it } from "vitest";
import { emptyView, reduce } from "@bob/sdlc-view";

import { sdlcBeats } from "../src/sdlc-beats";
import { delta, snapshot, viewOf } from "./fixtures";

const base = viewOf(snapshot([{ itemId: "1", state: "running" }, { itemId: "2", state: "validating" }, { itemId: "3", state: "review" }]));
const kinds = (prev = base, ...msgs: Parameters<typeof reduce>[1][]) => {
  const next = msgs.reduce(reduce, prev);
  return sdlcBeats(prev, next, 1000).map((b) => `${b.subject.itemId ?? "-"}:${b.kind}${b.data?.milestone ? `:${b.data.milestone}` : ""}`);
};

describe("sdlcBeats", () => {
  it("treats the first snapshot and a new epoch as a baseline, not as events", () => {
    expect(sdlcBeats(emptyView(), base, 0)).toEqual([]);
    const reset = reduce(base, snapshot([{ itemId: "1", state: "completed" }], "e2", 1));
    expect(sdlcBeats(base, reset, 0)).toEqual([]);
  });

  it("classifies forward moves, loops, failures and needs-human", () => {
    expect(
      kinds(
        base,
        delta(2, [
          { itemId: "1", state: "waiting-input", rv: 2 },
          { itemId: "2", state: "failed", rv: 2 },
          { itemId: "3", state: "validating", rv: 2 },
        ]),
      ),
    ).toEqual(["1:item.needs_human", "2:item.failed", "3:item.looped"]);
    expect(kinds(base, delta(2, [{ itemId: "1", state: "validating", rv: 2 }]))).toEqual(["1:item.advanced"]);
  });

  it("emits release stages, a CI miss and new milestones once", () => {
    const prev = reduce(base, delta(2, [{ itemId: "2", state: "validating", rv: 2, release: { stage: "checks-running" } }]));
    expect(
      kinds(prev, delta(3, [{ itemId: "2", state: "validating", rv: 3, release: { stage: "checks-failed" }, milestones: ["execution-succeeded"] }])),
    ).toEqual(["2:item.failed", "2:release.stage", "2:milestone:execution-succeeded"]);
  });

  it("emits item.left when a plan completes", () => {
    expect(kinds(base, delta(2, [], "completed", 2))).toEqual(["1:item.left", "2:item.left", "3:item.left"]);
  });

  it("emits one gap beat when the edge skips a seq", () => {
    const out = kinds(base, delta(5, [{ itemId: "1", state: "validating", rv: 2 }]));
    expect(out).toEqual(["-:gap", "1:item.advanced"]);
  });

  it("is deterministic and replay-safe", () => {
    const d = delta(2, [{ itemId: "3", state: "deploying", rv: 2 }, { itemId: "1", state: "validating", rv: 2 }]);
    const shuffled = { ...d, items: [...(d as { items: unknown[] }).items].reverse() } as typeof d;
    const a = sdlcBeats(base, reduce(base, d), 7);
    const b = sdlcBeats(base, reduce(base, shuffled), 7);
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
    const once = reduce(base, d);
    expect(sdlcBeats(once, reduce(once, d), 8)).toEqual([]);
  });

  it("carries the tracker identifier and release refs", () => {
    const prev = reduce(base, delta(2, [{ itemId: "3", state: "review", rv: 2, release: { stage: "review-ready", pullRequest: { repository: { integrationId: "forgegraph", repositoryId: "bob" }, number: 305 } } }]));
    const next = reduce(prev, delta(3, [{ itemId: "3", state: "deploying", rv: 3, release: { stage: "deploying", deploymentId: "dep-9", mergeSha: "abc" }, milestones: ["merged"] }]));
    const beat = sdlcBeats(prev, next, 0).find((b) => b.kind === "milestone")!;
    expect(beat.subject).toMatchObject({ itemId: "3", issue: "BOB-3", deploymentId: "dep-9", sha: "abc" });
  });
});
