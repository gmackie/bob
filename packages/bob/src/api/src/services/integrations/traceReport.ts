import { tracedFetch } from "@gmacko/core/telemetry/deep";

/** Only the configured Kanbanger clone supports this metadata API. */
export async function reportKanbangerTrace(
  config: { apiUrl: string; apiKey: string },
  issueId: string,
  reference: {
    taskRunId: string;
    attemptId: string;
    traceId: string;
    rootSpanId: string;
    outcome: "running" | "success" | "error";
    captureState: "pending" | "sampled_out";
    services: string[];
  },
): Promise<void> {
  const configured = new URL(config.apiUrl);
  if (
    configured.origin !== "https://tasks.gmac.io" ||
    configured.username ||
    configured.password
  )
    return;
  const response = await tracedFetch(
    new URL("/api/trpc/attachment.recordTrace", configured),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({ json: { issueId, reference } }),
      signal: AbortSignal.timeout(5_000),
    },
    { service: "kanbanger", baseUrl: configured.origin },
  );
  if (!response.ok) throw new Error("Trace reference delivery failed");
}
