import { Schema } from "effect";

// Effect 4 translation: `Schema.DateFromString` (Effect 3.x) does not exist in
// effect@4.0.0-beta.43. The closest analog is `Schema.DateTimeUtcFromString`,
// which decodes a string into a `DateTime.Utc`. See the plan's Effect 4 API
// reference table.
export const Timestamp = Schema.DateTimeUtcFromString;

export const NonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
);

export const Email = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
);
