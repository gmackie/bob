export function buildHeadlessSessionDestination(
  sessionId: string,
  baseUrl: string,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return `${normalizedBaseUrl}/chat?mode=headless&session=${encodeURIComponent(sessionId)}`;
}
