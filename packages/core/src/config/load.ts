import { Effect, Schema } from "effect";

// Decode a Schema against process.env (or an injected record for tests).
//
// Fails with a `Schema.SchemaError` on invalid/missing vars. Undefined entries
// in `env` (unset vars) are filtered out before decoding so a `Schema.String`
// field for an unset var surfaces as a missing-property error rather than a
// "expected string, got undefined" error.
//
// Effect 4 note: the Effect-returning decoder is `Schema.decodeUnknownEffect`
// (not `Schema.decodeUnknown`), and the error type is `Schema.SchemaError`
// (not `ParseResult.ParseError`).
export const loadConfig = <S extends Schema.Top>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): Effect.Effect<S["Type"], Schema.SchemaError, S["DecodingServices"]> => {
  const input: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") input[k] = v;
  }
  return Schema.decodeUnknownEffect(schema)(input);
};
