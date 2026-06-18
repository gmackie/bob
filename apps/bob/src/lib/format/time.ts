/**
 * Format a date as a relative time string: "2h ago", "yesterday", "Mar 12".
 */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  const d = new Date(then);
  const thisYear = new Date().getFullYear();
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();

  if (d.getFullYear() === thisYear) {
    return `${month} ${day}`;
  }

  return `${month} ${day}, ${d.getFullYear()}`;
}
