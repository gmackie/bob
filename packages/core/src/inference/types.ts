export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ResponseFormat = { type: "json_object" | "text" };

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string | string[];
  response_format?: ResponseFormat;
  stream?: boolean;
};

export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number;
};

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }[];
  usage?: ChatCompletionUsage;
};

export type ModelRecord = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type ModelsListResponse = {
  object: "list";
  data: ModelRecord[];
};

export const MODEL_APIS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "groq",
  "mistral",
  "openrouter",
  "ollama",
] as const;

export type ModelApi = (typeof MODEL_APIS)[number];

export type ParsedModel = {
  api: ModelApi;
  model: string;
};
