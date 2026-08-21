/** Daily digest of the autonomous loop — pure renderer over collected metrics. */

export interface DigestMetrics {
  date: string; // YYYY-MM-DD (UTC) the digest covers (the last 24h up to now)
  dispatched: number;
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  deploysOk: number;
  deploysFailed: number;
  sessionsCompleted: number;
  sessionsErrored: number;
  sessionsBlocked: number;
  reviewsRun: number;
  repairsRun: number;
  queue: { todo: number; backlog: number; inProgress: number; inReview: number; blocked: number; done: number };
  medianLeadMinutes: number | null; // claim → merge, for PRs merged in window
  capUsed: number;
  capTotal: number;
  agents: { agent: string; completed: number; errored: number }[];
  notes: string[];
}

function hm(minutes: number | null): string {
  if (minutes == null) return "n/a";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
}

export function renderDigest(m: DigestMetrics): string {
  const mergeRate = m.prsOpened ? Math.round((100 * m.prsMerged) / Math.max(1, m.prsOpened)) : 0;
  const lines = [
    `📊 **Bob daily digest — ${m.date}** (last 24h)`,
    ``,
    `**Throughput:** ${m.dispatched} dispatched · ${m.prsOpened} PRs opened · ${m.prsMerged} merged (${mergeRate}% of opened) · ${m.prsClosed} closed unmerged`,
    `**Deploys:** ${m.deploysOk} 🚀 ok · ${m.deploysFailed} 💥 failed`,
    `**Convergence:** ${m.reviewsRun} reviews · ${m.repairsRun} repairs · median claim→merge ${hm(m.medianLeadMinutes)}`,
    `**Sessions:** ${m.sessionsCompleted} completed · ${m.sessionsErrored} errored · ${m.sessionsBlocked} blocked`,
    `**Queue now:** ${m.queue.todo} todo · ${m.queue.inProgress} in progress · ${m.queue.inReview} in review · ${m.queue.blocked} blocked · ${m.queue.backlog} backlog · ${m.queue.done} done`,
    `**Budget:** ${m.capUsed}/${m.capTotal} execute runs used today`,
  ];
  if (m.agents.length) {
    lines.push(
      `**Agents:** ` +
        m.agents.map((a) => `${a.agent} ${a.completed}✓${a.errored ? `/${a.errored}✗` : ""}`).join(" · "),
    );
  }
  if (m.notes.length) {
    lines.push(``, ...m.notes.map((n) => `⚠️ ${n}`));
  }
  return lines.join("\n");
}

/** Things worth a human's eye, derived from the same metrics. */
export function digestNotes(m: Omit<DigestMetrics, "notes">): string[] {
  const notes: string[] = [];
  if (m.sessionsErrored > 0 && m.sessionsErrored >= 3 * Math.max(1, m.sessionsCompleted)) {
    notes.push(`Error-heavy day: ${m.sessionsErrored} errored vs ${m.sessionsCompleted} completed — check the newest session errors (agent auth/limits, worktree, git push).`);
  }
  if (m.capUsed >= m.capTotal && m.queue.todo > 0) {
    notes.push(`Daily cap (${m.capTotal}) is the throughput limiter — ${m.queue.todo} items still in todo.`);
  }
  if (m.deploysFailed > 0) {
    notes.push(`${m.deploysFailed} merge(s) have a failed deploy — the code is on the default branch but not live.`);
  }
  if (m.queue.blocked > 0) {
    notes.push(`${m.queue.blocked} work item(s) are blocked after repeated failed runs and need a human.`);
  }
  if (m.prsOpened > 0 && m.prsMerged === 0 && m.reviewsRun === 0) {
    notes.push(`PRs were opened but no reviews ran — check the reviewer token / review agent.`);
  }
  for (const a of m.agents) {
    if (a.errored >= 3 && a.completed === 0) notes.push(`${a.agent}: ${a.errored} errors, 0 completions — likely auth/rate-limit; consider pulling it from BOB_AUTO_DRAIN_AGENTS.`);
  }
  return notes;
}
