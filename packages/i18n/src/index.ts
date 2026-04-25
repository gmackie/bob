// @gmacko/i18n — Phase 6L peripheral package stub.
//
// Public surface:
//   - `I18n` — Effect service: `t(key, vars?)`, `locale()`, `setLocale(locale)`.
//   - `layerI18nStub` — graceful-degradation Layer: `t` returns the key,
//     `locale` returns "en-US", `setLocale` fails with the tagged error.
//   - Tagged error: `I18nNotImplementedError`.
//   - Types: `Locale`, `I18nShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). The stub `t` returns
// the key as the translation so UI can render the key text instead of crashing.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export type Locale = string; // BCP 47 language tag

export class I18nNotImplementedError extends Schema.TaggedErrorClass<I18nNotImplementedError>()(
  "I18nNotImplementedError",
  {
    reason: Schema.String,
    key: Schema.optional(Schema.String),
  },
) {}

export interface I18nShape {
  /** Translate a key. `vars` are interpolated into the resolved string. */
  readonly t: (
    key: string,
    vars?: Record<string, string | number>,
  ) => Effect.Effect<string, I18nNotImplementedError>;
  /** Get the current locale. */
  readonly locale: () => Effect.Effect<Locale>;
  /** Switch to a different locale. */
  readonly setLocale: (
    locale: Locale,
  ) => Effect.Effect<void, I18nNotImplementedError>;
}

export const I18n = ServiceMap.Service<I18nShape>("@gmacko/i18n/I18n");

const reason = "@gmacko/i18n: deferred to Phase 7 (Bob migration)";

/**
 * Stub Layer: `t` returns the key (graceful degradation), `locale` reports
 * en-US, `setLocale` fails with `I18nNotImplementedError`. Real Layer to be
 * provided in Phase 7.
 */
export const layerI18nStub: Layer.Layer<I18nShape> = Layer.succeed(I18n, {
  t: (key) => Effect.succeed(key),
  locale: () => Effect.succeed("en-US" as Locale),
  setLocale: (locale) =>
    Effect.fail(
      new I18nNotImplementedError({
        reason,
        key: `setLocale:${locale}`,
      }),
    ),
});

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoI18nPhase = "6l" as const;
