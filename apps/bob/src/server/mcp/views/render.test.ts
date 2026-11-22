import { describe, expect, it } from "vitest";
import { buildPlanningWorkflow } from "./planning";
import type { WorkItem } from "./types";
import { renderPlanning, renderWorkspace } from "./render";

const item: WorkItem = { providerId: "bob", id: "w1", title: "Fix <script>alert(1)</script>", status: { id: "todo", label: "todo", category: "backlog" }, scope: {} };

describe("view renderers", () => {
  it("escapes Bob content and filters work items", () => {
    const html = renderWorkspace({ workspaceId: "ws", workItems: [item, { ...item, id: "w2", title: "Other" }], runs: [], pollSeconds: 60, refreshedAt: "2026-10-31T00:00:00Z" }, "fix");
    expect(html).toContain("Fix &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-work-item-id="w1"');
    expect(html).not.toContain('data-work-item-id="w2"');
    expect(html).toContain("No runs yet.");
  });

  it("shows a runs error alongside the work items instead of claiming there are no runs", () => {
    const html = renderWorkspace({ workspaceId: "ws", workItems: [item], runs: [], runsError: "Timed out <upstream>", pollSeconds: 60, refreshedAt: "2026-10-31T00:00:00Z" });
    expect(html).toContain('data-work-item-id="w1"');
    expect(html).toContain('role="alert">Runs unavailable: Timed out &lt;upstream&gt;');
    expect(html).not.toContain("No runs yet.");
  });

  it("limits runs to the active thread in a thread-scoped panel", () => {
    const data = {
      workspaceId: "ws",
      workItems: [item],
      runs: [
        { providerId: "bob", id: "r1", status: "running" as const, threadId: "t1" },
        { providerId: "bob", id: "r2", status: "queued" as const, threadId: "t2" },
      ],
      pollSeconds: 60,
      refreshedAt: "2026-10-31T00:00:00Z",
    };
    const html = renderWorkspace(data, "", "t1");
    expect(html).toContain("Runs in this thread");
    expect(html).toContain("r1");
    expect(html).not.toContain("r2");
    expect(renderWorkspace(data, "", "t3")).toContain("No Bob runs for this thread.");
  });

  it("offers approve, then dispatch, then nothing", () => {
    const approve = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, []) });
    expect(approve).toContain('data-action="approve"');
    const execute = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, [], { approved: true }) }, { busy: true, error: "Bob API down" });
    expect(execute).toContain('data-action="execute" disabled');
    expect(execute).toContain('role="alert">Bob API down');
    const verify = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, [{ providerId: "bob", id: "s1", status: "failed" }], { approved: true, dispatchRequested: true }) });
    expect(verify).not.toContain('class="actions"');
    expect(verify).toContain("step-failed");
  });

  it("shows completed execution and unknown approval without a dispatch button", () => {
    const done = { ...item, status: { id: "done", label: "done", category: "done" as const } };
    const runs = [{ providerId: "bob", id: "r1", status: "succeeded" as const, workItemId: done.id }];
    const html = renderPlanning({ workItem: done, runs, workflow: buildPlanningWorkflow(done, runs) });
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toContain('data-action="execute"');
    expect(html).toContain("unknown");
    expect(html).toContain("succeeded");
  });
});
