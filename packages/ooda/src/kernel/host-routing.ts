import { isSafeSpeakableText } from "./tts-policy";

export type HostProviderId = "grok" | "claude" | "openai";

export interface HostMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HostProviderCompletion {
  providerResponseId: string;
  model: string;
  text: string;
}

export interface HostProviderClient {
  id: HostProviderId;
  complete(input: {
    messages: HostMessage[];
    system: string;
    signal?: AbortSignal;
  }): Promise<HostProviderCompletion>;
}

export interface HostOutput {
  display: string;
  speakable?: string;
}

export interface HostProviderFailure {
  provider: HostProviderId;
  code: "PROVIDER_UNAVAILABLE" | "PROVIDER_FAILED";
}

export class HostRoutingError extends Error {
  constructor(readonly failures: HostProviderFailure[]) {
    super("Every configured conversational host failed");
    this.name = "HostRoutingError";
  }
}

function parseOutput(text: string): unknown {
  const trimmed = text.trim();
  const candidate =
    trimmed.startsWith("```json") && trimmed.endsWith("```")
      ? trimmed.slice(7, -3).trim()
      : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

export function normalizeHostOutput(text: string): HostOutput {
  const trimmed = text.trim();
  const parsed = parseOutput(trimmed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const display =
      typeof record.display === "string" && record.display.trim()
        ? record.display.trim()
        : trimmed;
    const speakable =
      typeof record.speakable === "string" ? record.speakable.trim() : "";
    return {
      display,
      ...(speakable && isSafeSpeakableText(speakable) ? { speakable } : {}),
    };
  }

  return {
    display: trimmed,
    ...(trimmed && trimmed.length <= 700 && isSafeSpeakableText(trimmed)
      ? { speakable: trimmed }
      : {}),
  };
}

export async function routeHostCompletion(input: {
  preferredProvider: HostProviderId;
  providers: HostProviderClient[];
  messages: HostMessage[];
  system: string;
  signal?: AbortSignal;
}) {
  const order: HostProviderId[] = [
    input.preferredProvider,
    ...(["grok", "claude", "openai"] as const).filter(
      (provider) => provider !== input.preferredProvider,
    ),
  ];
  const clients = new Map(input.providers.map((client) => [client.id, client]));
  const failures: HostProviderFailure[] = [];

  for (const provider of order) {
    const client = clients.get(provider);
    if (!client) {
      failures.push({ provider, code: "PROVIDER_UNAVAILABLE" });
      continue;
    }
    try {
      const completion = await client.complete({
        messages: input.messages,
        system: input.system,
        signal: input.signal,
      });
      return {
        provider,
        model: completion.model,
        providerResponseId: completion.providerResponseId,
        output: normalizeHostOutput(completion.text),
        ...(failures.length
          ? {
              fallback: {
                preferredProvider: input.preferredProvider,
                failures,
              },
            }
          : {}),
      };
    } catch {
      failures.push({ provider, code: "PROVIDER_FAILED" });
    }
  }

  throw new HostRoutingError(failures);
}
