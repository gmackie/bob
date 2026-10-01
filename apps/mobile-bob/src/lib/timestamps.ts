/**
 * Timestamps as the servers actually send them.
 *
 * Drizzle's `mode: "string"` columns come off the wire as Postgres text:
 * `2026-09-30 16:51:29.479-04` or, for columns without a zone,
 * `2026-09-30 20:51:29.479`. Node's Date parses the first form, so nothing
 * server-side noticed. Hermes does not parse either, so on a device every
 * "2m ago" read "No activity" and every elapsed time was blank. This turns
 * those into ISO 8601 before handing them to Date; ISO input passes through.
 */

const POSTGRES_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function normalizeTimestamp(value: string): string {
  const match = POSTGRES_TIMESTAMP.exec(value.trim());
  if (!match) return value;
  const [, date, time, zone] = match;
  let suffix = "Z";
  if (zone && zone !== "Z") {
    // "-04" → "-04:00", "+0530" → "+05:30"; "-04:00" is already right.
    const sign = zone[0];
    const digits = zone.slice(1).replace(":", "");
    const hours = digits.slice(0, 2);
    const minutes = digits.length > 2 ? digits.slice(2, 4) : "00";
    suffix = `${sign}${hours}:${minutes}`;
  }
  return `${date}T${time}${suffix}`;
}

/** Milliseconds since the epoch, or null for anything unparseable. */
export function timestampToMillis(
  value: string | number | Date | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = new Date(normalizeTimestamp(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}
