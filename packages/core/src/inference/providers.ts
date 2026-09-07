import type { InferenceKeys } from "./env";
import { hasKeyFor } from "./env";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatMessage,
  ParsedModel,
} from "./types";

export class InferenceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "InferenceError";
    this.status = status;
  }
}

type CompletionResult = {
  text: string;
  usage?: ChatCompletionUsage;
};

function openaiBase(
  keys: InferenceKeys,
  spec: ParsedModel,
): { url: string; key: string; model: string } {
  switch (spec.api) {
    case "xai":
      return {
        url: "https://api.x.ai/v1",
        key: keys.xai || keys.openrouter,
        model: spec.model,
      };
    case "deepseek":
      return {
        url: "https://api.deepseek.com/v1",
        key: keys.deepseek || keys.openrouter,
        model: spec.model,
      };
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1",
        key: keys.groq || keys.openrouter,
        model: spec.model,
      };
    case "mistral":
      return {
        url: "https://api.mistral.ai/v1",
        key: keys.mistral || keys.openrouter,
        model: spec.model,
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1",
        key: keys.openrouter,
        model: spec.model,
      };
    case "ollama":
      return {
        url: keys.ollama.replace(/\/$/, ""),
        key: "ollama",
        model: spec.model,
      };
    default:
      return {
        url: "https://api.openai.com/v1",
        key: keys.openai || keys.openrouter,
        model: spec.model,
      };
  }
}

function usageFromOpenAi(raw: unknown): ChatCompletionUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const prompt =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion =
    typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const total =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : prompt + completion;
  const cost =
    typeof usage.cost === "number"
      ? usage.cost
      : typeof usage.total_cost === "number"
        ? usage.total_cost
        : undefined;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    ...(cost !== undefined ? { cost } : {}),
  };
}

async function openaiCompatChat(
  keys: InferenceKeys,
  spec: ParsedModel,
  messages: ChatMessage[],
  req: ChatCompletionRequest,
): Promise<CompletionResult> {
  const { url, key, model } = openaiBase(keys, spec);
  if (!key) {
    throw new InferenceError(503, `No API key configured for ${spec.api}`);
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: req.temperature ?? 0.9,
  };
  if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
  if (req.stop !== undefined) body.stop = req.stop;
  if (req.response_format) body.response_format = req.response_format;
  if (spec.api === "openrouter") body.usage = { include: true };

  const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://bob.blder.bot",
      "X-Title": "Gmacko Inference Gateway",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new InferenceError(
      res.status,
      `${spec.api} ${res.status}: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: unknown;
  };

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: usageFromOpenAi(data.usage),
  };
}

async function anthropicChat(
  keys: InferenceKeys,
  spec: ParsedModel,
  messages: ChatMessage[],
  req: ChatCompletionRequest,
): Promise<CompletionResult> {
  const key = keys.anthropic || keys.openrouter;
  if (!key) {
    throw new InferenceError(503, "No API key configured for anthropic");
  }

  if (keys.openrouter && !keys.anthropic) {
    return openaiCompatChat(
      keys,
      { api: "openrouter", model: `anthropic/${spec.model}` },
      messages,
      req,
    );
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const rest = messages.filter((m) => m.role !== "system");
  const json = req.response_format?.type === "json_object";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: spec.model,
      max_tokens: req.max_tokens ?? 1024,
      system: json ? `${system}\nRespond with JSON only.` : system,
      messages: rest.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    }),
  });

  if (!res.ok) {
    throw new InferenceError(
      res.status,
      `anthropic ${res.status}: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    text: data.content?.find((c) => c.type === "text")?.text ?? "",
    usage: data.usage
      ? {
          prompt_tokens: data.usage.input_tokens ?? 0,
          completion_tokens: data.usage.output_tokens ?? 0,
          total_tokens:
            (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

async function geminiChat(
  keys: InferenceKeys,
  spec: ParsedModel,
  messages: ChatMessage[],
  req: ChatCompletionRequest,
): Promise<CompletionResult> {
  const key = keys.gemini || keys.openrouter;
  if (!key) {
    throw new InferenceError(503, "No API key configured for google");
  }

  if (keys.openrouter && !keys.gemini) {
    return openaiCompatChat(
      keys,
      { api: "openrouter", model: `google/${spec.model}` },
      messages,
      req,
    );
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");
  const json = req.response_format?.type === "json_object";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: json ? `${system}\nRespond with JSON only.` : system }],
      },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        ...(json ? { responseMimeType: "application/json" } : {}),
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.max_tokens !== undefined
          ? { maxOutputTokens: req.max_tokens }
          : {}),
      },
    }),
  });

  if (!res.ok) {
    throw new InferenceError(
      res.status,
      `google ${res.status}: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const meta = data.usageMetadata;

  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    usage: meta
      ? {
          prompt_tokens: meta.promptTokenCount ?? 0,
          completion_tokens: meta.candidatesTokenCount ?? 0,
          total_tokens:
            meta.totalTokenCount ??
            (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0),
        }
      : undefined,
  };
}

export async function completeChat(
  keys: InferenceKeys,
  spec: ParsedModel,
  req: ChatCompletionRequest,
): Promise<CompletionResult> {
  if (!hasKeyFor(keys, spec.api)) {
    throw new InferenceError(
      503,
      `No API key configured for provider ${spec.api}. Set ${spec.api.toUpperCase()}_API_KEY or OPENROUTER_API_KEY.`,
    );
  }

  if (req.stream) {
    throw new InferenceError(501, "Streaming is not supported yet");
  }

  switch (spec.api) {
    case "anthropic":
      return anthropicChat(keys, spec, req.messages, req);
    case "google":
      return geminiChat(keys, spec, req.messages, req);
    default:
      return openaiCompatChat(keys, spec, req.messages, req);
  }
}

export function toChatCompletionResponse(
  model: string,
  result: CompletionResult,
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      },
    ],
    ...(result.usage ? { usage: result.usage } : {}),
  };
}
