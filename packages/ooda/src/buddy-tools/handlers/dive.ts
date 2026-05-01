// Dive handlers: spawn / poll / collect.
//
// V1.5 maps 1:1 onto `research.dive{Spawn,Status,Results}` tRPC
// procedures. Naming shifts snake_case (wire / agent) → camelCase (tRPC).
// Shape shifts are kept in one place here so the rest of the dispatcher
// can assume clean snake-wrapped payloads.

import type { ToolHandler } from "../handler";

export const dive_spawn: ToolHandler<"dive_spawn"> = async (args, ctx) => {
  const r = await ctx.trpc.research.diveSpawn({
    threadId: ctx.threadId,
    seeds: args.seeds,
    budgetPapers: args.budget_papers,
    budgetSeconds: args.budget_seconds,
    focus: args.focus,
  });
  // The backend returns snake_case already (it's a pass-through of the
  // research-backend REST body). We re-shape deliberately so downstream
  // consumers don't depend on what the sidecar happens to emit today.
  return {
    exploration_id: r.exploration_id,
    status: r.status,
  };
};

export const dive_status: ToolHandler<"dive_status"> = async (args, ctx) => {
  const r = await ctx.trpc.research.diveStatus({ id: args.exploration_id });
  // The research-backend row doesn't carry live counters yet — those are
  // in `meta` once populated. V1.5 surfaces what we have (status +
  // budgets + error) and leaves the counters at zero until the sidecar
  // starts emitting them. This matches the agent-facing schema's shape
  // so consumers don't branch on "which fields are present".
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const num = (k: string): number =>
    typeof meta[k] === "number" ? (meta[k] as number) : 0;
  const elapsed =
    r.started_at && r.finished_at
      ? (new Date(r.finished_at).getTime() -
          new Date(r.started_at).getTime()) /
        1000
      : r.started_at
        ? (Date.now() - new Date(r.started_at).getTime()) / 1000
        : 0;
  return {
    exploration_id: r.id,
    status: r.status,
    papers_visited: num("papers_visited"),
    papers_scored: num("papers_scored"),
    budget_papers: r.budget_papers,
    budget_seconds: r.budget_seconds,
    elapsed_seconds: Math.max(0, elapsed),
    eta_seconds: null,
    error: r.error_md ?? null,
  };
};

export const dive_results: ToolHandler<"dive_results"> = async (args, ctx) => {
  const r = await ctx.trpc.research.diveResults({
    id: args.exploration_id,
    topK: args.top_k,
  });
  // The research-backend returns a `papers: []` list whose rows mix paper
  // metadata with dive-specific scoring. The agent-facing `findings`
  // shape separates `paper` (snapshot of the `sources` row) from the
  // per-finding score + rationale. We map defensively: unknown fields
  // pass through as null rather than crashing the agent.
  const papers = (r.papers ?? []) as Record<string, unknown>[];
  return {
    exploration_id: r.exploration_id,
    findings: papers.map((p) => ({
      source_id:
        typeof p.source_id === "number" ? (p.source_id as number) : 0,
      paper: {
        source_id:
          typeof p.source_id === "number" ? (p.source_id as number) : 0,
        s2_paper_id:
          typeof p.s2_paper_id === "string"
            ? (p.s2_paper_id as string)
            : null,
        title: typeof p.title === "string" ? (p.title as string) : "",
        abstract:
          typeof p.abstract === "string" ? (p.abstract as string) : null,
        authors: Array.isArray(p.authors) ? (p.authors as string[]) : [],
        year: typeof p.year === "number" ? (p.year as number) : null,
        venue: typeof p.venue === "string" ? (p.venue as string) : null,
        citation_count:
          typeof p.citation_count === "number"
            ? (p.citation_count as number)
            : null,
        doi: typeof p.doi === "string" ? (p.doi as string) : null,
      },
      score: typeof p.score === "number" ? (p.score as number) : 0,
      rationale:
        typeof p.rationale === "string" ? (p.rationale as string) : null,
    })),
  };
};
