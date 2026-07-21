/**
 * Asserts a value is defined, throwing if not. Used in place of the `!`
 * non-null assertion operator when the surrounding logic (not the type
 * system) guarantees definedness — e.g. array access proven in-bounds by a
 * prior `.length` check, or a regex capture group that's unconditional in
 * the pattern. `noUncheckedIndexedAccess` can't encode either fact, so this
 * makes the assumption an explicit, named, runtime-checked step instead of
 * a silent `!`.
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Expected value to be defined");
  }
  return value;
}
