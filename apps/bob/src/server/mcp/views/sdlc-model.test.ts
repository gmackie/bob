import { describe, expect, it } from "vitest";

import { DEMO_THREADS, demoCi, demoItems, demoSnapshot, demoTail } from "./sdlc-fixtures";
import { fleet, itemForThread, threadItem } from "./sdlc-model";
import { emptyView, reduce } from "@bob/sdlc-view";

const view = reduce(emptyView(), demoSnapshot(1_000));

describe("thread → SDLC item", () => {
  it("matches execution.thread.threadId", () => {
    expect(itemForThread(view, DEMO_THREADS.running)?.itemId).toBe("item-a");
    expect(itemForThread(view, DEMO_THREADS.waiting)?.itemId).toBe("item-b");
    expect(itemForThread(view, DEMO_THREADS.none)).toBeNull();
  });

  it("prefers a live item, then the newest version, when several share a thread", () => {
    const old = { ...demoItems[0]!, itemId: "item-old", state: "failed" as const, resourceVersion: 99 };
    const withOld = reduce(view, { type: "delta", seq: 13, plans: [], items: [old], coordinatorSeenAt: null });
    expect(itemForThread(withOld, DEMO_THREADS.running)?.itemId).toBe("item-a");
  });

  it("builds the thread model with milestones, questions, tail and CI", () => {
    const item = threadItem(view, itemForThread(view, DEMO_THREADS.running)!, { tail: demoTail("item-a")!.frame, ci: demoCi("item-a") });
    expect(item).toMatchObject({ stateLabel: "Running", attention: "ok", planState: "active", issue: { identifier: "T3CODE-201" }, repository: "gmackie/t3code-bob-plugin" });
    expect(item.milestones.map((m) => m.achieved)).toEqual([false, false, false, false]);
    expect(item.tail?.lines).toContain("  42 pass");
    expect(item.ci).toMatchObject({ available: true, summary: "2 of 3 phases passed" });
    const waiting = threadItem(view, itemForThread(view, DEMO_THREADS.waiting)!);
    expect(waiting).toMatchObject({ stateLabel: "Waiting for input", attention: "needs_human" });
    expect(waiting.pendingQuestions).toHaveLength(1);
  });

  it("ignores a tail from an earlier attempt", () => {
    const frame = { ...demoTail("item-a")!.frame, attemptId: "att-old" };
    expect(threadItem(view, view.items["item-a"]!, { tail: frame }).tail).toBeUndefined();
  });
});

describe("fleet", () => {
  it("counts states, orders attention and reports plan progress", () => {
    const data = fleet(view);
    expect(data.totalItems).toBe(4);
    expect(data.counts).toEqual([
      { state: "pending", label: "Pending", count: 1 },
      { state: "running", label: "Running", count: 1 },
      { state: "waiting-input", label: "Waiting for input", count: 1 },
      { state: "completed", label: "Completed", count: 1 },
    ]);
    expect(data.attention).toEqual([{ itemId: "item-b", planId: "plan-sdlc-demo", identifier: "T3CODE-202", state: "waiting-input", stateLabel: "Waiting for input", attention: "needs_human", threadId: DEMO_THREADS.waiting }]);
    expect(data.plans).toEqual([{ planId: "plan-sdlc-demo", state: "active", total: 4, completed: 1, failed: 0, active: 2 }]);
  });
});
