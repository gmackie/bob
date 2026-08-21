import { Schema } from "effect";

const BoundedIdentifierSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

const Rfc3339TimestampSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    ),
  ),
);

const CaptureTextSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(8_000)),
);

const OperatorTextSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(4_000)),
);

const PositiveBoundedIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
);

const ScopeDigestSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
);

export const HermesOperatorChannelSchema = Schema.Literals([
  "telegram",
  "console",
  "bob",
]);

export const HermesOperatorIntentNameSchema = Schema.Literals([
  "today",
  "capture",
  "research",
  "work",
  "approve",
  "status",
  "fleet",
  "close",
  "stop",
]);

export type HermesOperatorChannel = typeof HermesOperatorChannelSchema.Type;
export type HermesOperatorIntentName =
  typeof HermesOperatorIntentNameSchema.Type;

function operatorIntent<const Name extends string, Payload extends Schema.Top>(
  intent: Name,
  payload: Payload,
) {
  return Schema.Struct({
    schemaVersion: Schema.Literal(1),
    requestId: BoundedIdentifierSchema,
    intent: Schema.Literal(intent),
    channel: HermesOperatorChannelSchema,
    occurredAt: Rfc3339TimestampSchema,
    payload,
  });
}

export const HermesTodayIntentSchema = operatorIntent(
  "today",
  Schema.Struct({}),
);

export const HermesCaptureIntentSchema = operatorIntent(
  "capture",
  Schema.Struct({
    text: CaptureTextSchema,
  }),
);

export const HermesResearchIntentSchema = operatorIntent(
  "research",
  Schema.Struct({
    question: OperatorTextSchema,
    sourceBudget: PositiveBoundedIntegerSchema,
    timeBudgetMinutes: PositiveBoundedIntegerSchema,
  }),
);

export const HermesWorkIntentSchema = operatorIntent(
  "work",
  Schema.Struct({ request: OperatorTextSchema }),
);

export const HermesApproveIntentSchema = operatorIntent(
  "approve",
  Schema.Struct({
    proposalId: BoundedIdentifierSchema,
    scopeDigest: ScopeDigestSchema,
  }),
);

export const HermesStatusIntentSchema = operatorIntent(
  "status",
  Schema.Struct({ query: OperatorTextSchema }),
);

export const HermesFleetIntentSchema = operatorIntent(
  "fleet",
  Schema.Struct({
    query: OperatorTextSchema,
    dryRun: Schema.Literal(true),
  }),
);

export const HermesCloseIntentSchema = operatorIntent(
  "close",
  Schema.Struct({}),
);

export const HermesStopIntentSchema = operatorIntent(
  "stop",
  Schema.Struct({ reason: OperatorTextSchema }),
);

export const HermesOperatorIntentSchema = Schema.Union([
  HermesTodayIntentSchema,
  HermesCaptureIntentSchema,
  HermesResearchIntentSchema,
  HermesWorkIntentSchema,
  HermesApproveIntentSchema,
  HermesStatusIntentSchema,
  HermesFleetIntentSchema,
  HermesCloseIntentSchema,
  HermesStopIntentSchema,
]);

export type HermesOperatorIntent = typeof HermesOperatorIntentSchema.Type;

export function parseHermesOperatorIntent(
  input: unknown,
): HermesOperatorIntent {
  return Schema.decodeUnknownSync(HermesOperatorIntentSchema)(input, {
    errors: "all",
    onExcessProperty: "error",
  });
}
