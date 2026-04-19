import { Schema } from "effect";

// Common env-var schemas that gmacko packages can reuse.
//
// Effect 4 note: filter APIs moved under `Schema.check(Schema.is<Name>(...))`.
// `isStartsWith` takes a positional string; `isBetween` takes an options object
// `{ minimum, maximum }`; `isInt` is a nullary function returning a filter.
export const NodeEnv = Schema.Literals(["development", "test", "production"]);

export const PostgresUrl = Schema.String.pipe(
  Schema.check(Schema.isStartsWith("postgres://")),
);

export const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
);
