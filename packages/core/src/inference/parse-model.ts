import { MODEL_APIS, type ModelApi, type ParsedModel } from "./types";

export function parseModelId(raw: string): ParsedModel | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash <= 0) {
    return { api: "openai", model: trimmed };
  }

  const api = trimmed.slice(0, slash);
  const model = trimmed.slice(slash + 1);
  if (!model) return null;

  if ((MODEL_APIS as readonly string[]).includes(api)) {
    return { api: api as ModelApi, model };
  }

  // Treat unknown prefixes (e.g. provider aliases) as openrouter model ids.
  return { api: "openrouter", model: trimmed };
}
