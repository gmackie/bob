// Registry mapping tool names to their handler functions.
//
// The dispatcher (Task 5.4) takes a ToolName + raw args, looks up the
// handler here, validates args via `TOOLS[name].args.parse(...)`, then
// invokes the handler with a HandlerContext.
//
// HANDLERS is keyed on `ToolName` (= keys of `TOOLS` = the implemented
// set). The six stub handlers in `./stubs` still exist — they're kept
// alongside `TOOLS_PLANNED` in schemas.ts so when a backing tRPC
// procedure lands we swap in the real handler, move the schema from
// PLANNED to IMPLEMENTED, and the dispatcher picks it up automatically.
// Until then neither the schema nor the handler is exposed to agents.

import type { ToolHandler } from "../handler";
import type { ToolName } from "../schemas";

import * as cp from "./cp";
import * as dive from "./dive";
import * as graph from "./graph";
import * as inbox from "./inbox";
import * as interests from "./interests";
import * as kb from "./kb";
import * as memory from "./memory";
import * as papers from "./papers";
import * as stubs from "./stubs";

export const HANDLERS: Record<ToolName, ToolHandler<ToolName>> = {
  dive_spawn: dive.dive_spawn as ToolHandler<ToolName>,
  dive_status: dive.dive_status as ToolHandler<ToolName>,
  dive_results: dive.dive_results as ToolHandler<ToolName>,
  papers_search: papers.papers_search as ToolHandler<ToolName>,
  paper_get: papers.paper_get as ToolHandler<ToolName>,
  graph_neighborhood: graph.graph_neighborhood as ToolHandler<ToolName>,
  graph_path: graph.graph_path as ToolHandler<ToolName>,
  thread_memory_search: memory.thread_memory_search as ToolHandler<ToolName>,
  thread_memory_update: memory.thread_memory_update as ToolHandler<ToolName>,
  thread_links_suggest: memory.thread_links_suggest as ToolHandler<ToolName>,
  interest_register: interests.interest_register as ToolHandler<ToolName>,
  interest_list: interests.interest_list as ToolHandler<ToolName>,
  interest_disable: interests.interest_disable as ToolHandler<ToolName>,
  inbox_list: inbox.inbox_list as ToolHandler<ToolName>,
  inbox_triage: inbox.inbox_triage as ToolHandler<ToolName>,
  kb_promote_request: kb.kb_promote_request as ToolHandler<ToolName>,
  cp_open_url: cp.cp_open_url as ToolHandler<ToolName>,
};

export { cp, dive, graph, inbox, interests, kb, memory, papers, stubs };
