/**
 * Postgres hands back `timestamp` ("2026-08-23 17:25:24.123"), `timestamptz`
 * ("2026-08-23 17:25:24.123+00" — note the HOUR-ONLY offset JS refuses), ISO
 * strings, and drizzle may already give Dates. Normalise without ever
 * producing an Invalid Date; null for anything unparseable.
 */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let t = v.trim();
  if (!t.includes("T")) t = t.replace(" ", "T");
  // "+00" / "-05" → "+00:00" / "-05:00"; "+0530" → "+05:30"
  t = t.replace(/([+-]\d\d)$/, "$1:00").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  if (!/[zZ]$|[+-]\d\d:\d\d$/.test(t)) t += "Z";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
