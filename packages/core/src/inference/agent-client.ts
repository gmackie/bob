import { InferenceError } from "./providers";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";

export function readOodaRunnerUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.OODA_RUNNER_URL?.trim() ||
    env.OODA_RUNNER_INFERENCE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

export async function completeViaRunner(
  req: ChatCompletionRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<ChatCompletionResponse> {
  const base = readOodaRunnerUrl(env);
  if (!base) {
    throw new InferenceError(
      503,
      "OODA_RUNNER_URL is not configured. Start ooda-runner with inference HTTP enabled.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bobApiKey = env.BOB_API_KEY?.trim();
  if (bobApiKey) {
    headers.Authorization = `Bearer ${bobApiKey}`;
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new InferenceError(
      res.status,
      body || `Runner returned HTTP ${res.status}`,
    );
  }

  return (await res.json()) as ChatCompletionResponse;
}
