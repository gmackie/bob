// Pure renderers for ui://bob/sdlc.html: one thread's SDLC item, or the fleet.
// Read-only: answering questions and every command happen in Bob.
import type { Attention } from "@bob/sdlc-view";
import type { EdgeStatus, SdlcData, SdlcFleetData, SdlcThreadData, SdlcThreadItem } from "./sdlc-model";
import { esc, pill } from "./render";

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

const attentionTone: Record<Attention, string> = { ok: "active", needs_human: "warning", stalled: "neutral", failed: "negative" };
const ciTone: Record<string, string> = { passed: "positive", failed: "negative", running: "active", queued: "neutral", skipped: "muted", unknown: "muted" };

function status(data: EdgeStatus): string {
  const live = data.connection === "live";
  const notes = [
    live ? pill("live", "positive") : pill(data.connection, "warning"),
    live && data.offline ? `<span class="error">Coordinator offline</span>` : "",
    `<span>Refreshed ${esc(time(data.refreshedAt))}</span>`,
  ].join("");
  return `<div class="header-meta">${notes}<button type="button" data-action="refresh">Refresh</button></div>`;
}

function edgeError(data: EdgeStatus): string {
  return data.error ? `<p class="error" role="alert">${esc(data.error)}</p>` : "";
}

function issueLabel(item: SdlcThreadItem): string {
  return item.issue?.identifier ?? item.issue?.issueId ?? item.itemId;
}

function renderItem(item: SdlcThreadItem): string {
  const milestones = item.milestones
    .map((m) => `<li class="step step-${m.achieved ? "completed" : "pending"}"><span class="step-icon" aria-hidden="true">${m.achieved ? "●" : "○"}</span><div class="row-title">${esc(m.label)}</div><span class="sr">${m.achieved ? "achieved" : "not yet"}</span></li>`)
    .join("");
  const questions = item.pendingQuestions.length
    ? `<section aria-label="Pending input"><h2>Waiting for your answer</h2><ul>${item.pendingQuestions
        .map(
          (q) => `<li class="row"><div class="row-main">${q.header ? `<div class="row-meta">${esc(q.header)}</div>` : ""}<div class="row-title">${esc(q.question)}</div>${
            q.options.length ? `<div class="row-detail">${q.options.map((o) => esc(o.label)).join(" · ")}${q.multiSelect ? " (choose any)" : ""}</div>` : ""
          }</div></li>`,
        )
        .join("")}</ul><p class="row-detail">Answer in Bob; this view is read-only.</p></section>`
    : "";
  const tail = item.tail
    ? `<section aria-label="Live tail"><h2>Live tail <span class="count">${esc(item.tail.threadStatus)} · ${esc(time(item.tail.at))}</span></h2><pre class="tail">${esc(item.tail.lines.join("\n"))}</pre></section>`
    : item.tailUnavailable
      ? `<section aria-label="Live tail"><h2>Live tail</h2><p class="row-detail">${esc(item.tailUnavailable)}</p></section>`
      : "";
  const ci = item.ci
    ? item.ci.available
      ? `<section aria-label="CI"><h2>CI <span class="count mono">${esc(item.ci.sha.slice(0, 10))}</span></h2><p class="row-detail">${esc(item.ci.summary)}</p><ul>${item.ci.phases
          .map((p) => `<li class="row"><div class="row-main"><div class="row-meta">${pill(p.status, ciTone[p.status] ?? "muted")}<span>${esc(p.name)}</span></div></div></li>`)
          .join("")}</ul></section>`
      : `<section aria-label="CI"><h2>CI</h2><p class="row-detail">${esc(item.ci.reason)}</p></section>`
    : "";
  // Only http(s) links: the URL comes from the issue tracker, not from Bob.
  const issue = item.issue?.url && /^https?:\/\//i.test(item.issue.url) ?`<a href="${esc(item.issue.url)}" target="_blank" rel="noreferrer">${esc(issueLabel(item))}</a>` : esc(issueLabel(item));
  return `<p class="subject"><strong>${issue}</strong> ${pill(item.stateLabel, attentionTone[item.attention])}${item.repository ? `<span class="mono">${esc(item.repository)}</span>` : ""}</p>
${item.stateHint ? `<p class="row-detail">${esc(item.stateHint)}</p>` : ""}
<section aria-label="Plan"><h2>Plan</h2><div class="row-meta"><span class="mono">${esc(item.planId)}</span>${pill(item.planState, "neutral")}<span class="mono">item ${esc(item.itemId)}</span>${item.attemptId ? `<span class="mono">attempt ${esc(item.attemptId)}</span>` : ""}</div></section>
<section aria-label="Milestones"><h2>Milestones</h2><ol class="steps">${milestones}</ol></section>
${questions}${tail}${ci}`;
}

export function renderSdlcThread(data: SdlcThreadData): string {
  return `<header><h1>Bob SDLC</h1>${status(data)}</header>
${edgeError(data)}
${data.item ? renderItem(data.item) : `<p class="empty">No Bob SDLC item is running this thread.</p>`}`;
}

export function renderSdlcFleet(data: SdlcFleetData): string {
  const counts = data.counts.length
    ? `<ul class="counts">${data.counts.map((c) => `<li><span class="count-n">${c.count}</span> ${esc(c.label)}</li>`).join("")}</ul>`
    : `<p class="empty">No active SDLC items.</p>`;
  const attention = data.attention.length
    ? data.attention
        .map(
          (a) => `<li class="row"><div class="row-main"><div class="row-title">${esc(a.identifier ?? a.itemId)}</div><div class="row-meta">${pill(a.stateLabel, attentionTone[a.attention])}<span class="mono">${esc(a.planId)}</span>${a.threadId ? `<span class="mono">thread ${esc(a.threadId)}</span>` : ""}</div></div></li>`,
        )
        .join("")
    : `<li class="empty">Nothing needs attention.</li>`;
  const plans = data.plans.length
    ? data.plans
        .map((p) => {
          const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
          return `<li class="row"><div class="row-main"><div class="row-title mono">${esc(p.planId)}</div><div class="row-meta">${pill(p.state, p.state === "active" ? "active" : "neutral")}<span>${p.completed}/${p.total} completed</span>${p.active ? `<span>${p.active} in flight</span>` : ""}${p.failed ? `<span class="error">${p.failed} failed</span>` : ""}</div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div></div></li>`;
        })
        .join("")
    : `<li class="empty">No active plans.</li>`;
  return `<header><h1>Bob SDLC fleet</h1>${status(data)}</header>
${edgeError(data)}
<section aria-label="States"><h2>Items <span class="count">${data.totalItems}</span></h2>${counts}</section>
<section aria-label="Attention"><h2>Needs attention <span class="count">${data.attention.length}</span></h2><ul>${attention}</ul></section>
<section aria-label="Plans"><h2>Plans <span class="count">${data.plans.length}</span></h2><ul>${plans}</ul></section>`;
}

export function renderSdlc(data: SdlcData): string {
  return data.scope === "thread" ? renderSdlcThread(data) : renderSdlcFleet(data);
}

export const SDLC_STYLES = `
.tail { margin: 0; padding: 8px; border: 1px solid var(--line); border-radius: 6px; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; }
.counts { display: flex; flex-wrap: wrap; gap: 6px 14px; } .counts li { color: var(--muted); } .count-n { color: var(--fg); font-weight: 600; }
.progress { height: 4px; margin-top: 6px; background: var(--line); border-radius: 2px; overflow: hidden; } .progress span { display: block; height: 100%; background: var(--pos); }
a { color: var(--accent); }
`;
