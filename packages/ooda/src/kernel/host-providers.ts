import type {
  HostProviderClient,
  HostProviderCompletion,
  HostProviderId,
} from "./host-routing";

export interface HostProviderConfig {
  xaiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  grokModel?: string;
  claudeModel?: string;
  openaiModel?: string;
}

const OODA_HOST_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "ooda_host_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      display: { type: "string" },
      speakable: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    },
    required: ["display", "speakable"],
    additionalProperties: false,
  },
} as const;

function nestedOutputText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.text === "string") return record.text;
  for (const key of ["output", "content"] as const) {
    const child = record[key];
    if (!Array.isArray(child)) continue;
    const text = child
      .map((item) => nestedOutputText(item))
      .filter((item): item is string => Boolean(item))
      .join("");
    if (text) return text;
  }
  return undefined;
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error("Conversational host request failed");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Conversational host returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function openAiCompatibleProvider(input: {
  id: Extract<HostProviderId, "grok" | "openai">;
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}): HostProviderClient {
  return {
    id: input.id,
    async complete(request): Promise<HostProviderCompletion> {
      const response = await input.fetchImpl(input.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          instructions: request.system,
          input: request.messages,
          text: { format: OODA_HOST_RESPONSE_FORMAT },
        }),
        signal: request.signal,
      });
      const body = await responseJson(response);
      const text = nestedOutputText(body);
      if (!text) throw new Error("Conversational host returned no text");
      return {
        providerResponseId:
          typeof body.id === "string" ? body.id : crypto.randomUUID(),
        model: typeof body.model === "string" ? body.model : input.model,
        text,
      };
    },
  };
}

function anthropicProvider(input: {
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}): HostProviderClient {
  return {
    id: "claude",
    async complete(request): Promise<HostProviderCompletion> {
      const response = await input.fetchImpl(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": input.apiKey,
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: 4_096,
            system: request.system,
            messages: request.messages,
          }),
          signal: request.signal,
        },
      );
      const body = await responseJson(response);
      const text = nestedOutputText(body);
      if (!text) throw new Error("Conversational host returned no text");
      return {
        providerResponseId:
          typeof body.id === "string" ? body.id : crypto.randomUUID(),
        model: typeof body.model === "string" ? body.model : input.model,
        text,
      };
    },
  };
}

export function createHostProviderClients(
  config: HostProviderConfig,
  fetchImpl: typeof fetch = fetch,
): HostProviderClient[] {
  const providers: HostProviderClient[] = [];
  if (config.xaiApiKey) {
    providers.push(
      openAiCompatibleProvider({
        id: "grok",
        endpoint: "https://api.x.ai/v1/responses",
        apiKey: config.xaiApiKey,
        model: config.grokModel ?? "grok-4.5",
        fetchImpl,
      }),
    );
  }
  if (config.anthropicApiKey) {
    providers.push(
      anthropicProvider({
        apiKey: config.anthropicApiKey,
        model: config.claudeModel ?? "claude-opus-4-6",
        fetchImpl,
      }),
    );
  }
  if (config.openaiApiKey) {
    providers.push(
      openAiCompatibleProvider({
        id: "openai",
        endpoint: "https://api.openai.com/v1/responses",
        apiKey: config.openaiApiKey,
        model: config.openaiModel ?? "gpt-5",
        fetchImpl,
      }),
    );
  }
  return providers;
}
