import { DateTime } from "effect";

/** Normalize the timestamp variants accepted by Effect's wire contracts. */
export function timestampString(value: string | Date | DateTime.Utc): string {
  if (typeof value === "string") return value;
  return value instanceof Date
    ? value.toISOString()
    : DateTime.formatIso(value);
}
