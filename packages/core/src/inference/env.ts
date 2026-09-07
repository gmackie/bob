export type InferenceKeys = {
  openai: string;
  anthropic: string;
  gemini: string;
  xai: string;
  deepseek: string;
  groq: string;
  mistral: string;
  openrouter: string;
  ollama: string;
  bobApiKey: string;
};

export function readInferenceKeys(
  env: Record<string, string | undefined> = process.env,
): InferenceKeys {
  return {
    openai: env.OPENAI_API_KEY?.trim() ?? "",
    anthropic: env.ANTHROPIC_API_KEY?.trim() ?? "",
    gemini: env.GEMINI_API_KEY?.trim() ?? "",
    xai: env.XAI_API_KEY?.trim() ?? "",
    deepseek: env.DEEPSEEK_API_KEY?.trim() ?? "",
    groq: env.GROQCLOUD_API_KEY?.trim() ?? "",
    mistral: env.MISTRAL_API_KEY?.trim() ?? "",
    openrouter: env.OPENROUTER_API_KEY?.trim() ?? "",
    ollama: env.OLLAMA_URL?.trim() ?? "http://127.0.0.1:11434/v1",
    bobApiKey: env.BOB_API_KEY?.trim() ?? "",
  };
}

export function hasRunnerConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    env.OODA_RUNNER_URL?.trim() || env.OODA_RUNNER_INFERENCE_URL?.trim(),
  );
}

export function hasKeyFor(keys: InferenceKeys, api: string): boolean {
  switch (api) {
    case "openai":
      return Boolean(keys.openai || keys.openrouter);
    case "anthropic":
      return Boolean(keys.anthropic || keys.openrouter);
    case "google":
      return Boolean(keys.gemini || keys.openrouter);
    case "xai":
      return Boolean(keys.xai || keys.openrouter);
    case "deepseek":
      return Boolean(keys.deepseek || keys.openrouter);
    case "groq":
      return Boolean(keys.groq || keys.openrouter);
    case "mistral":
      return Boolean(keys.mistral || keys.openrouter);
    case "openrouter":
      return Boolean(keys.openrouter);
    case "ollama":
      return Boolean(keys.ollama);
    default:
      return false;
  }
}
