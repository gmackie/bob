export function getPlanningWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    env.PLANNING_WEBHOOK_SECRET?.trim() ||
    env.KANBANGER_WEBHOOK_SECRET?.trim() ||
    null
  );
}

export function isPlanningWebhookHeader(key: string): boolean {
  return (
    key.startsWith("x-planning") ||
    key.startsWith("x-kanbanger") ||
    key.startsWith("x-webhook") ||
    key === "content-type"
  );
}
