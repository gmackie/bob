import type { ChatMessage } from "@gmacko/core/inference";

type GrokResult = { text: string };

export async function completeGrok(
  model: string,
  messages: ChatMessage[],
  opts: {
    json?: boolean;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<GrokResult> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error("XAI_API_KEY is not configured for grok agent routing");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.9,
  };
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`grok ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  return { text: data.choices?.[0]?.message?.content ?? "" };
}
