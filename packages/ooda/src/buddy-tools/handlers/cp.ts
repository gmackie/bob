// Connected Papers handoff — builds CP URLs from local source ids.
//
// The agent-facing schema takes `source_ids: number[]` and wants S2
// paper ids to build the URLs (https://www.connectedpapers.com/main/{s2}).
// V1.5 does NOT yet have a tRPC procedure exposing the
// source_id → s2_paper_id map — it lives on the `graph_node` table but
// only `research.graphByThread` reads it, and that query is thread- and
// not id-scoped.
//
// Rather than invent ad-hoc DB access from buddy-tools (which would
// break the "handlers call tRPC only" contract for V1.5), we return
// URL rows with `s2_paper_id: null` and `url: null`. The dispatcher
// surfaces this as `ok:true, data:{urls: [...]}` — the agent can detect
// the nulls and either fall back to another tool or ask the user to
// consult the dashboard.
//
// When the follow-up `research.papersByIds` procedure lands, this
// handler grows one tRPC call and a real URL per row.

import type { ToolHandler } from "../handler";

export const cp_open_url: ToolHandler<"cp_open_url"> = async (args) => {
  return {
    urls: args.source_ids.map((id) => ({
      source_id: id,
      s2_paper_id: null,
      url: null,
    })),
  };
};
