export const DEFAULT_LINEAR_WEB_BASE_URL = "https://linear.app";

const LINEAR_WEB_HOSTS = new Set(["linear.app", "www.linear.app"]);

export function normalizeLinearWebBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_LINEAR_WEB_BASE_URL;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(candidate);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function rewriteLinearWebUrl(
  url: string | null | undefined,
  baseUrl?: string | null,
): string | undefined {
  if (!url) return undefined;

  const normalizedBaseUrl = normalizeLinearWebBaseUrl(baseUrl);
  if (normalizedBaseUrl === DEFAULT_LINEAR_WEB_BASE_URL) return url;

  try {
    const parsedUrl = new URL(url);
    if (!LINEAR_WEB_HOSTS.has(parsedUrl.hostname)) return url;

    const parsedBase = new URL(normalizedBaseUrl);
    parsedUrl.protocol = parsedBase.protocol;
    parsedUrl.hostname = parsedBase.hostname;
    parsedUrl.port = parsedBase.port;
    parsedUrl.username = "";
    parsedUrl.password = "";
    return parsedUrl.toString();
  } catch {
    return url;
  }
}
