// @gmacko/agent-toolkit — Phase 6L peripheral package stub.
//
// Public surface: three Effect services that an agent runtime can wrap as
// agent-callable tools.
//   - `Memory` — persisted recall/remember store (`MemoryShape`).
//   - `WebSearch` — single-shot web search (`WebSearchShape`).
//   - `CodeIndex` — repository code search + read (`CodeIndexShape`).
//   - `layerMemoryStub` / `layerWebSearchStub` / `layerCodeIndexStub` —
//     individual stub Layers that fail every method.
//   - `layerAgentToolkitStub` — merged Layer for all three services.
//   - Tagged error: `AgentToolkitNotImplementedError`.
//
// Real implementation deferred to Phase 7 (Bob migration). Each service gets
// a per-driver impl as Bob's tool surface materializes.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly tags?: readonly string[];
}

export interface WebSearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface CodeIndexResult {
  readonly path: string;
  readonly line: number;
  readonly snippet: string;
}

export class AgentToolkitNotImplementedError extends Schema.TaggedErrorClass<AgentToolkitNotImplementedError>()(
  "AgentToolkitNotImplementedError",
  {
    reason: Schema.String,
    tool: Schema.optional(Schema.String),
  },
) {}

export interface MemoryShape {
  readonly remember: (
    content: string,
    tags?: readonly string[],
  ) => Effect.Effect<MemoryEntry, AgentToolkitNotImplementedError>;
  readonly recall: (
    query: string,
    limit?: number,
  ) => Effect.Effect<readonly MemoryEntry[], AgentToolkitNotImplementedError>;
  readonly forget: (
    id: string,
  ) => Effect.Effect<void, AgentToolkitNotImplementedError>;
}

export interface WebSearchShape {
  readonly search: (
    query: string,
    limit?: number,
  ) => Effect.Effect<readonly WebSearchResult[], AgentToolkitNotImplementedError>;
}

export interface CodeIndexShape {
  readonly search: (
    query: string,
    limit?: number,
  ) => Effect.Effect<readonly CodeIndexResult[], AgentToolkitNotImplementedError>;
  readonly read: (
    path: string,
  ) => Effect.Effect<string, AgentToolkitNotImplementedError>;
}

export const Memory = ServiceMap.Service<MemoryShape>(
  "@gmacko/agent-toolkit/Memory",
);
export const WebSearch = ServiceMap.Service<WebSearchShape>(
  "@gmacko/agent-toolkit/WebSearch",
);
export const CodeIndex = ServiceMap.Service<CodeIndexShape>(
  "@gmacko/agent-toolkit/CodeIndex",
);

const reason = "@gmacko/agent-toolkit: deferred to Phase 7 (Bob migration)";

const fail = (
  tool: string,
): Effect.Effect<never, AgentToolkitNotImplementedError> =>
  Effect.fail(new AgentToolkitNotImplementedError({ reason, tool }));

export const layerMemoryStub: Layer.Layer<MemoryShape> = Layer.succeed(Memory, {
  remember: () => fail("memory.remember"),
  recall: () => fail("memory.recall"),
  forget: () => fail("memory.forget"),
});

export const layerWebSearchStub: Layer.Layer<WebSearchShape> = Layer.succeed(
  WebSearch,
  {
    search: () => fail("webSearch.search"),
  },
);

export const layerCodeIndexStub: Layer.Layer<CodeIndexShape> = Layer.succeed(
  CodeIndex,
  {
    search: () => fail("codeIndex.search"),
    read: () => fail("codeIndex.read"),
  },
);

export const layerAgentToolkitStub: Layer.Layer<
  MemoryShape | WebSearchShape | CodeIndexShape
> = Layer.mergeAll(layerMemoryStub, layerWebSearchStub, layerCodeIndexStub);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoAgentToolkitPhase = "6l" as const;
