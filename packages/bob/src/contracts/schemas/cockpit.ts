// Cockpit wire data. Keep in sync with the collector domain types.
import { Schema } from "effect";
export const PriorityLaneSchema = Schema.Union([
  Schema.Literal("urgent"),
  Schema.Literal("high"),
  Schema.Literal("medium"),
  Schema.Literal("unset"),
  Schema.Literal("low"),
]);
export const QueueCardSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.Union([Schema.String, Schema.Null]),
  title: Schema.String,
  repo: Schema.Union([Schema.String, Schema.Null]),
  lane: PriorityLaneSchema,
  ready: Schema.Boolean,
  agentOverride: Schema.Union([Schema.String, Schema.Null]),
  provider: Schema.Union([Schema.String, Schema.Null]),
  ageMinutes: Schema.Number,
});
export const CheckPhaseRollupSchema = Schema.Struct({
  phase: Schema.String,
  status: Schema.String,
  durationMs: Schema.optional(Schema.Number),
  counts: Schema.optional(
    Schema.Struct({
      passed: Schema.Number,
      failed: Schema.Number,
      skipped: Schema.optional(Schema.Number),
      total: Schema.optional(Schema.Number),
    }),
  ),
  confidence: Schema.optional(Schema.String),
  failures: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        suite: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    ),
  ),
});
export const CheckRollupSchema = Schema.Struct({
  status: Schema.Union([Schema.Literal("passed"), Schema.Literal("failed")]),
  at: Schema.String,
  phases: Schema.mutable(Schema.Array(CheckPhaseRollupSchema)),
});
export const FgCiEvidenceSchema = Schema.Struct({
  app: Schema.String,
  status: Schema.Union([
    Schema.Literal("pass"),
    Schema.Literal("pending"),
    Schema.Literal("fail"),
    Schema.Literal("none"),
  ]),
  hasCIHistory: Schema.Boolean,
  builds: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        pipelineName: Schema.String,
        status: Schema.String,
        runUrl: Schema.String,
        tests: Schema.Union([CheckRollupSchema, Schema.Null]),
      }),
    ),
  ),
  failures: Schema.Union([
    Schema.Struct({
      headline: Schema.String,
      tests: Schema.mutable(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            suite: Schema.optional(Schema.String),
            message: Schema.optional(Schema.String),
          }),
        ),
      ),
      errors: Schema.mutable(Schema.Array(Schema.String)),
    }),
    Schema.Null,
  ]),
});
export const LiveSessionSchema = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  status: Schema.String,
  phase: Schema.Union([
    Schema.Literal("execute"),
    Schema.Literal("review"),
    Schema.Literal("repair"),
    Schema.Literal("other"),
  ]),
  title: Schema.String,
  identifier: Schema.Union([Schema.String, Schema.Null]),
  workItemId: Schema.Union([Schema.String, Schema.Null]),
  repo: Schema.Union([Schema.String, Schema.Null]),
  branch: Schema.Union([Schema.String, Schema.Null]),
  startedAt: Schema.String,
  elapsedSeconds: Schema.Number,
  pr: Schema.Union([
    Schema.Struct({
      number: Schema.Number,
      repo: Schema.String,
      url: Schema.String,
    }),
    Schema.Null,
  ]),
  provider: Schema.Union([Schema.String, Schema.Null]),
  check: Schema.Union([CheckRollupSchema, Schema.Null]),
});
export const PipelineStageStateSchema = Schema.Union([
  Schema.Literal("done"),
  Schema.Literal("active"),
  Schema.Literal("failed"),
  Schema.Literal("waiting"),
  Schema.Literal("skipped"),
]);
export const PrPipelineSchema = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  identifier: Schema.Union([Schema.String, Schema.Null]),
  headSha: Schema.Union([Schema.String, Schema.Null]),
  openedAt: Schema.String,
  stages: Schema.Struct({
    code: PipelineStageStateSchema,
    ci: PipelineStageStateSchema,
    review: PipelineStageStateSchema,
    repair: PipelineStageStateSchema,
    merge: PipelineStageStateSchema,
    deploy: PipelineStageStateSchema,
  }),
  ci: Schema.Union([
    Schema.Struct({
      state: Schema.String,
      jobs: Schema.mutable(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            status: Schema.String,
          }),
        ),
      ),
    }),
    Schema.Null,
  ]),
  fgCi: Schema.Union([FgCiEvidenceSchema, Schema.Null]),
  agentCheck: Schema.Union([CheckRollupSchema, Schema.Null]),
  review: Schema.Union([
    Schema.Struct({
      verdict: Schema.Union([Schema.String, Schema.Null]),
      by: Schema.Union([Schema.String, Schema.Null]),
    }),
    Schema.Null,
  ]),
  repair: Schema.Struct({
    attempts: Schema.Number,
    cap: Schema.Number,
    inFlight: Schema.Boolean,
  }),
  parkedReason: Schema.Union([Schema.String, Schema.Null]),
});
export const AgentHealthChipSchema = Schema.Struct({
  agent: Schema.String,
  completed: Schema.Number,
  errored: Schema.Number,
  healthy: Schema.Boolean,
  reason: Schema.String,
  inRotation: Schema.Boolean,
});
export const TimelineEventSchema = Schema.Struct({
  at: Schema.String,
  kind: Schema.Union([
    Schema.Literal("dispatch"),
    Schema.Literal("pr"),
    Schema.Literal("merge"),
    Schema.Literal("deploy"),
    Schema.Literal("deploy_failed"),
    Schema.Literal("failure"),
    Schema.Literal("review"),
    Schema.Literal("human"),
  ]),
  agent: Schema.Union([Schema.String, Schema.Null]),
  label: Schema.String,
  url: Schema.optional(Schema.String),
});
export const CockpitStatusSchema = Schema.Struct({
  generatedAt: Schema.String,
  loop: Schema.Struct({
    lastTickAt: Schema.Union([Schema.String, Schema.Null]),
    tickAgeSeconds: Schema.Union([Schema.Number, Schema.Null]),
    syncedAt: Schema.Union([Schema.String, Schema.Null]),
    syncAgeSeconds: Schema.Union([Schema.Number, Schema.Null]),
    syncResult: Schema.Union([Schema.String, Schema.Null]),
    dispatchEnabled: Schema.Boolean,
  }),
  pacing: Schema.Struct({
    cap: Schema.Number,
    used: Schema.Number,
    earned: Schema.Number,
    allowance: Schema.Number,
    burst: Schema.Number,
    concurrency: Schema.Number,
    activeSlots: Schema.Number,
  }),
  agents: Schema.mutable(Schema.Array(AgentHealthChipSchema)),
  queue: Schema.Struct({
    lanes: Schema.Record(
      PriorityLaneSchema,
      Schema.mutable(Schema.Array(QueueCardSchema)),
    ),
    backlog: Schema.Number,
    total: Schema.Number,
  }),
  sessions: Schema.mutable(Schema.Array(LiveSessionSchema)),
  prs: Schema.Struct({
    active: Schema.mutable(Schema.Array(PrPipelineSchema)),
    parked: Schema.mutable(Schema.Array(PrPipelineSchema)),
  }),
  counts: Schema.Struct({
    todo: Schema.Number,
    inProgress: Schema.Number,
    inReview: Schema.Number,
    blocked: Schema.Number,
    done: Schema.Number,
    backlog: Schema.Number,
  }),
  timeline: Schema.mutable(Schema.Array(TimelineEventSchema)),
  sparklines: Schema.Struct({
    dispatches: Schema.mutable(Schema.Array(Schema.Number)),
    merges: Schema.mutable(Schema.Array(Schema.Number)),
    errors: Schema.mutable(Schema.Array(Schema.Number)),
  }),
  alerts: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        message: Schema.String,
        since: Schema.Union([Schema.String, Schema.Null]),
      }),
    ),
  ),
});
