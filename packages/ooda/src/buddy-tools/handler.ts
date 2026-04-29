// Handler context + contract for ACP-exposed buddy tools.
//
// Handlers run inside the OODA runner process and translate a validated
// tool call into one (or zero, for pure tools) tRPC procedure invocations.
// The dispatcher (Task 5.4 + 5.5) wraps the thrown-or-returned result in a
// `ToolResult` envelope.
//
// We type `ctx.trpc` against `AppRouter` so handlers stay honest about
// which procedures they call: if the server signature drifts, the handler
// fails to compile. At runtime the dispatcher supplies EITHER an
// in-process caller (cheap, V1.5 default) OR the HTTP client from
// `apps/runner/src/trpc-client.ts` — both conform to the same method
// shape `{ procName: (input) => Promise<output> }` because we wrap the
// HTTP client's `.query()`/`.mutate()` callables at dispatcher build
// time.
//
// Keeping this interface loose on the runtime side means the test suite
// can pass a plain object of recorded mock functions — no tRPC plumbing
// required.

import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@gmacko/ooda/api";

import type { ToolArgs, ToolName } from "./schemas";

type RI = inferRouterInputs<AppRouter>;
type RO = inferRouterOutputs<AppRouter>;

/**
 * The subset of the tRPC router the buddy-tools handlers actually call.
 *
 * Listing every procedure explicitly here means: (a) the dispatcher
 * knows which tRPC methods it must expose, (b) a mock context in tests
 * need only stub these, and (c) server-side signature changes cause
 * compile-time breakage at the handler call sites.
 *
 * Each field is a `(input) => Promise<output>` matching the tRPC
 * procedure exactly via `inferRouterInputs` / `inferRouterOutputs`.
 */
export interface ResearchTRPCSurface {
  diveSpawn: (input: RI["research"]["diveSpawn"]) => Promise<RO["research"]["diveSpawn"]>;
  diveStatus: (input: RI["research"]["diveStatus"]) => Promise<RO["research"]["diveStatus"]>;
  diveResults: (input: RI["research"]["diveResults"]) => Promise<RO["research"]["diveResults"]>;
  linksByThread: (
    input: RI["research"]["linksByThread"],
  ) => Promise<RO["research"]["linksByThread"]>;
  inboxByThread: (
    input: RI["research"]["inboxByThread"],
  ) => Promise<RO["research"]["inboxByThread"]>;
  inboxTriage: (
    input: RI["research"]["inboxTriage"],
  ) => Promise<RO["research"]["inboxTriage"]>;
  interestRegister: (
    input: RI["research"]["interestRegister"],
  ) => Promise<RO["research"]["interestRegister"]>;
  interestList: (
    input: RI["research"]["interestList"],
  ) => Promise<RO["research"]["interestList"]>;
  interestDisable: (
    input: RI["research"]["interestDisable"],
  ) => Promise<RO["research"]["interestDisable"]>;
  kbPromoteRequest: (
    input: RI["research"]["kbPromoteRequest"],
  ) => Promise<RO["research"]["kbPromoteRequest"]>;
  toolCallLogInsert: (
    input: RI["research"]["toolCallLogInsert"],
  ) => Promise<RO["research"]["toolCallLogInsert"]>;
  toolCallLogFinish: (
    input: RI["research"]["toolCallLogFinish"],
  ) => Promise<RO["research"]["toolCallLogFinish"]>;
  paperNeighborhood: (
    input: RI["research"]["paperNeighborhood"],
  ) => Promise<RO["research"]["paperNeighborhood"]>;
  paperPath: (
    input: RI["research"]["paperPath"],
  ) => Promise<RO["research"]["paperPath"]>;
  papersSearchVault: (
    input: RI["research"]["papersSearchVault"],
  ) => Promise<RO["research"]["papersSearchVault"]>;
  paperById: (
    input: RI["research"]["paperById"],
  ) => Promise<RO["research"]["paperById"]>;
  threadMemorySearch: (
    input: RI["research"]["threadMemorySearch"],
  ) => Promise<RO["research"]["threadMemorySearch"]>;
  threadMemoryUpdate: (
    input: RI["research"]["threadMemoryUpdate"],
  ) => Promise<RO["research"]["threadMemoryUpdate"]>;
}

export interface HandlerContext {
  /** The thread this tool call belongs to. Every handler threads this through. */
  threadId: string;
  /** Optional runner session id; logged by Task 5.4 middleware. */
  runnerSessionId?: string;
  /** tRPC caller restricted to the procedures buddy tools actually use. */
  trpc: {
    research: ResearchTRPCSurface;
  };
}

/**
 * A handler takes validated args (post-Zod) and a HandlerContext, returns
 * the tool-specific payload. The dispatcher wraps success in
 * `{ok:true, data}` and thrown errors in `{ok:false, error:{...}}`.
 */
export type ToolHandler<T extends ToolName> = (
  args: ToolArgs<T>,
  ctx: HandlerContext,
) => Promise<unknown>;

/**
 * Structured error thrown by stubs / non-implemented tools. The
 * dispatcher recognizes this class and forwards `{code, retryable}` into
 * the ToolResult envelope without additional wrapping.
 */
export class ToolHandlerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, opts?: { retryable?: boolean }) {
    super(message);
    this.name = "ToolHandlerError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
  }
}
