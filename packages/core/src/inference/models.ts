import { AGENT_MODELS } from "./agents";
import { hasKeyFor, hasRunnerConfigured, readInferenceKeys } from "./env";
import type { ModelRecord, ModelsListResponse } from "./types";

/** Common models BigBro and Mindcraft request via Bob. */
export const KNOWN_MODELS: readonly { id: string; owned_by: string }[] = [
  { id: "openai/gpt-4o", owned_by: "openai" },
  { id: "openai/gpt-4o-mini", owned_by: "openai" },
  { id: "anthropic/claude-sonnet-4-5", owned_by: "anthropic" },
  { id: "anthropic/claude-opus-4-6", owned_by: "anthropic" },
  { id: "google/gemini-2.5-pro", owned_by: "google" },
  { id: "google/gemini-2.5-flash", owned_by: "google" },
  { id: "google/gemini-2.5-flash-lite", owned_by: "google" },
  { id: "google/gemma-3-27b-it", owned_by: "google" },
  { id: "xai/grok-3", owned_by: "xai" },
  { id: "deepseek/deepseek-chat", owned_by: "deepseek" },
  { id: "groq/llama-3.1-8b-instant", owned_by: "groq" },
  { id: "groq/llama-3.3-70b-versatile", owned_by: "groq" },
  { id: "mistral/mistral-small-latest", owned_by: "mistral" },
  { id: "mistral/mistral-large-latest", owned_by: "mistral" },
  { id: "openrouter/openai/gpt-4o-mini", owned_by: "openrouter" },
  { id: "ollama/llama3.2:1b", owned_by: "ollama" },
  { id: "ollama/llama3.2", owned_by: "ollama" },
];

export function listModels(
  env: Record<string, string | undefined> = process.env,
): ModelsListResponse {
  const keys = readInferenceKeys(env);
  const created = 1700000000;
  const openrouterOnly = Boolean(keys.openrouter);

  const data: ModelRecord[] = [];

  if (hasRunnerConfigured(env)) {
    for (const row of AGENT_MODELS) {
      data.push({
        id: row.id,
        object: "model",
        created,
        owned_by: row.owned_by,
      });
    }
  }

  for (const row of KNOWN_MODELS) {
    const provider = row.owned_by;
    if (openrouterOnly || hasKeyFor(keys, provider)) {
      data.push({
        id: row.id,
        object: "model",
        created,
        owned_by: provider,
      });
    }
  }

  return { object: "list", data };
}
