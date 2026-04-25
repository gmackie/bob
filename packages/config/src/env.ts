import { Schema } from "effect";

// Common env-var schemas that gmacko packages can reuse.
//
// Effect 4 note: filter APIs moved under `Schema.check(Schema.is<Name>(...))`.
// `isStartsWith` takes a positional string; `isBetween` takes an options object
// `{ minimum, maximum }`; `isInt` is a nullary function returning a filter.
export const NodeEnv = Schema.Literals(["development", "test", "production"]);

export const PostgresUrl = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^postgres(?:ql)?:\/\//)),
);

export const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
);

// Pubsub / streaming backend selection for `@gmacko/realtime`. The literals
// match the three backend Layers (memory in-process, Redis cross-process,
// hosted ws-gateway). Consumers read this from env to drive `layerRealtime`.
export const RealtimeBackend = Schema.Literals(["memory", "redis", "ws-gateway"]);
export type RealtimeBackend = typeof RealtimeBackend.Type;
