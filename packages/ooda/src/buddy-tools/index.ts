// @ooda/buddy-tools — ACP-exposed tools for the academic research buddy.
// V1.5 scaffold. Schemas (5.2) + handlers (5.3) land here; dispatcher +
// budget/log middleware land in Tasks 5.4-5.5.

export const VERSION = "0.1.0";

export { HANDLERS } from "./handlers";
export {
  type HandlerContext,
  type ResearchTRPCSurface,
  type ToolHandler,
  ToolHandlerError,
} from "./handler";

export {
  withBudget,
  withLogging,
  withMiddleware,
  summarize,
  type BudgetState,
  type BudgetCost,
  type WithMiddlewareOptions,
} from "./middleware";

export {
  // Envelope + shared primitives
  ToolResultSchema,
  type ToolResult,
  PaperIdSchema,
  type PaperId,
  PaperSummarySchema,
  type PaperSummary,
  GraphEdgeKindSchema,
  type GraphEdgeKind,
  DiveStatusSchema,
  type DiveStatus,
  ThreadMemoryScopeSchema,
  type ThreadMemoryScope,
  InterestCadenceSchema,
  type InterestCadence,
  InboxTriageStateSchema,
  type InboxTriageState,
  // Individual tool schemas
  papers_search,
  paper_get,
  graph_neighborhood,
  graph_path,
  dive_spawn,
  dive_status,
  dive_results,
  thread_memory_search,
  thread_memory_update,
  thread_links_suggest,
  interest_register,
  interest_list,
  interest_disable,
  inbox_list,
  inbox_triage,
  kb_promote_request,
  cp_open_url,
  // Registry + type helpers
  TOOLS,
  TOOLS_IMPLEMENTED,
  TOOLS_PLANNED,
  TOOL_NAMES,
  type ToolName,
  type AnyToolName,
  type ToolArgs,
  type ToolResultPayload,
} from "./schemas";
