import { DateTime, Schema, SchemaGetter } from "effect";

// Effect 4 does not ship a literal `Schema.DateFromString`. We compose one by
// piping the built-in `DateTimeUtcFromString` (which handles `Date.parse`
// validation and ISO 8601 round-tripping) through a final `decodeTo(Schema.Date)`
// step that unwraps `DateTime.Utc` → JS `Date`. This keeps Effect's string
// validation but yields a native `Date` for downstream consumers (Drizzle
// timestamp columns, JSON serializers, React props) that don't speak Effect.
export const Timestamp = Schema.DateTimeUtcFromString.pipe(
  Schema.decodeTo(Schema.Date, {
    decode: SchemaGetter.transform((dt: DateTime.Utc) => DateTime.toDateUtc(dt)),
    encode: SchemaGetter.transform((d: Date) => DateTime.fromDateUnsafe(d)),
  }),
);

export const NonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
);

export const Email = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
);
