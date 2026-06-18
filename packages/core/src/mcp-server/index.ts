// @gmacko/mcp-server — Phase 6L peripheral package stub.
//
// Public surface:
//   - `McpServer` — Effect service exposing tool registration + request handling.
//   - `layerMcpServerStub` — Layer that fails every method with `McpServerNotImplementedError`.
//   - Tagged error: `McpServerNotImplementedError`.
//   - Types: `McpToolSchema`, `McpServerShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). The stub will swap
// in a Model Context Protocol bridge that surfaces `agent.toolUse` events from
// `@gmacko/agent`.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface McpToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export class McpServerNotImplementedError extends Schema.TaggedErrorClass<McpServerNotImplementedError>()(
  "McpServerNotImplementedError",
  {
    reason: Schema.String,
    tool: Schema.optional(Schema.String),
  },
) {}

export interface McpServerShape {
  readonly registerTool: (
    tool: McpToolSchema,
    handler: (input: unknown) => Effect.Effect<unknown, unknown>,
  ) => Effect.Effect<void, McpServerNotImplementedError>;
  readonly listTools: () => Effect.Effect<
    readonly McpToolSchema[],
    McpServerNotImplementedError
  >;
  readonly handleRequest: (request: {
    tool: string;
    input: unknown;
  }) => Effect.Effect<unknown, McpServerNotImplementedError>;
}

export const McpServer = ServiceMap.Service<McpServerShape>(
  "@gmacko/mcp-server/McpServer",
);

const reason = "@gmacko/mcp-server: deferred to Phase 7 (Bob migration)";
const fail = (
  tool?: string,
): Effect.Effect<never, McpServerNotImplementedError> =>
  Effect.fail(new McpServerNotImplementedError({ reason, tool }));

export const layerMcpServerStub: Layer.Layer<McpServerShape> = Layer.succeed(
  McpServer,
  {
    registerTool: (tool) => fail(tool.name),
    listTools: () => fail(),
    handleRequest: (req) => fail(req.tool),
  },
);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoMcpServerPhase = "6l" as const;
