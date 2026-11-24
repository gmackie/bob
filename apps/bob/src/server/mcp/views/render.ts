// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { PlanningWorkflowModel } from "./planning";
import type { RunSummary, WorkItem } from "./types";

export type WorkspaceData = {
  workspaceId: string;
  threadId?: string;
  workItems: readonly WorkItem[];
  runs: readonly RunSummary[];
  runsError?: string;
  pollSeconds: number;
  refreshedAt: string;
};

export type PlanningData = {
  workItem: WorkItem;
  runs: readonly RunSummary[];
  workflow: PlanningWorkflowModel;
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

export function pill(label: string, tone: string): string {
  return `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
}

const runTone: Record<RunSummary["status"], string> = {
  queued: "neutral",
  running: "active",
  succeeded: "positive",
  failed: "negative",
  cancelled: "muted",
};

const itemTone: Record<WorkItem["status"]["category"], string> = {
  backlog: "neutral",
  active: "active",
  blocked: "warning",
  done: "positive",
  cancelled: "muted",
};

export function renderWorkspace(data: WorkspaceData, filter = "", threadId?: string): string {
  const query = filter.trim().toLowerCase();
  const items = query ? data.workItems.filter((item) => item.title.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)) : data.workItems;
  const titles = new Map(data.workItems.map((item) => [item.id, item.title]));
  const rows = items.length
    ? items
        .map(
          (item) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(item.title)}</div>
    <div class="row-meta">${pill(item.status.label, itemTone[item.status.category])}<span class="mono">${esc(item.id)}</span>${item.updatedAt ? `<span>updated ${esc(time(item.updatedAt))}</span>` : ""}</div>
  </div>
  <button type="button" data-action="review" data-work-item-id="${esc(item.id)}">Review</button>
</li>`,
        )
        .join("\n")
    : `<li class="empty">${query ? "No work items match the filter." : "No Bob work items in this workspace."}</li>`;
  const scopedRuns = threadId ? data.runs.filter((run) => run.threadId === threadId) : data.runs;
  const runs = data.runsError
    ? `<li class="error" role="alert">Runs unavailable: ${esc(data.runsError)}. Use Refresh to retry.</li>`
    : scopedRuns.length
    ? scopedRuns
        .slice(0, 10)
        .map(
          (run) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(run.workItemId ? (titles.get(run.workItemId) ?? run.workItemId) : "Ad-hoc run")}</div>
    <div class="row-meta">${pill(run.status, runTone[run.status])}${run.agentType ? `<span>${esc(run.agentType)}</span>` : ""}<span class="mono">${esc(run.id)}</span>${run.createdAt ? `<span>${esc(time(run.createdAt))}</span>` : ""}</div>
    ${run.summary ? `<div class="row-detail">${esc(run.summary)}</div>` : ""}
  </div>
</li>`,
        )
        .join("\n")
    : `<li class="empty">${threadId ? "No Bob runs for this thread." : "No runs yet."}</li>`;
  return `<header>
  <h1>Bob workspace</h1>
  <div class="header-meta"><span>Refreshed ${esc(time(data.refreshedAt))} · every ${esc(data.pollSeconds)}s</span><button type="button" data-action="refresh">Refresh</button></div>
</header>
<input type="search" data-role="filter" placeholder="Filter work items" value="${esc(filter)}" aria-label="Filter work items">
<section aria-label="Work items"><h2>Work items <span class="count">${items.length}</span></h2><ul>${rows}</ul></section>
<section aria-label="Runs"><h2>${threadId ? "Runs in this thread" : "Recent runs"}${data.runsError ? "" : ` <span class="count">${scopedRuns.length}</span>`}</h2><ul>${runs}</ul></section>
<div data-role="review"></div>`;
}

const stepIcon: Record<PlanningWorkflowModel["steps"][number]["state"], string> = {
  pending: "○",
  active: "◐",
  completed: "●",
  blocked: "◌",
  failed: "✕",
};

export function renderPlanning(data: PlanningData, options: { busy?: boolean; error?: string } = {}): string {
  const { workflow, workItem } = data;
  const steps = workflow.steps
    .map(
      (step) => `<li class="step step-${esc(step.state)}"><span class="step-icon" aria-hidden="true">${stepIcon[step.state]}</span><div><div class="row-title">${esc(step.title)}</div>${step.detail ? `<div class="row-detail">${esc(step.detail)}</div>` : ""}</div><span class="sr">${esc(step.state)}</span></li>`,
    )
    .join("\n");
  const evidence = (workflow.evidence ?? [])
    .map((item) => `<li class="row"><div class="row-main"><div class="row-title">${esc(item.title)}</div><div class="row-meta">${pill(item.status, item.status)}${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</div></div></li>`)
    .join("\n");
  const actions = (workflow.actions ?? [])
    .map((action) =>
      action.id === "execute"
        ? `<label class="field">Agent <input data-role="agent-type" placeholder="Bob default" autocomplete="off"></label><button type="button" class="primary" data-action="execute" ${options.busy ? "disabled" : ""}>${esc(action.title)}</button>`
        : `<button type="button" class="${action.tone === "primary" ? "primary" : ""}" data-action="${esc(action.id)}" ${options.busy ? "disabled" : ""}>${esc(action.title)}</button>`,
    )
    .join("");
  return `<header>
  <h1>${esc(workflow.title)}</h1>
  <div class="header-meta"><span>Stage: <strong>${esc(workflow.currentStage)}</strong></span><button type="button" data-action="refresh-review">Refresh</button></div>
</header>
<p class="subject">${esc(workItem.title)} ${pill(workItem.status.label, itemTone[workItem.status.category])} <span class="mono">${esc(workItem.id)}</span></p>
${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ""}
<ol class="steps">${steps}</ol>
${evidence ? `<section aria-label="Evidence"><h2>Evidence</h2><ul>${evidence}</ul></section>` : ""}
${actions ? `<div class="actions">${actions}</div>` : ""}`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul, ol { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail { color: var(--muted); font-size: 12px; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-active { color: var(--accent); } .pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral, .pill-muted { color: var(--muted); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
input[type="search"] { width: 100%; margin-top: 10px; }
.steps { margin-top: 10px; } .step { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; }
.step-icon { width: 14px; text-align: center; color: var(--muted); } .step-active .step-icon { color: var(--accent); } .step-completed .step-icon { color: var(--pos); } .step-failed .step-icon { color: var(--neg); }
.step-pending .row-title { color: var(--muted); font-weight: 400; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; flex-wrap: wrap; } .field { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.error { color: var(--neg); } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
[data-role="review"]:not(:empty) { margin-top: 16px; padding-top: 4px; border-top: 2px solid var(--line); }
`;
