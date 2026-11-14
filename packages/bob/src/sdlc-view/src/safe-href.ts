const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * A coordinator-supplied URL that is safe to render as an href: an absolute http(s)
 * URL, else null. Anything else (javascript:, data:, vbscript:, relative) is shown as text.
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
