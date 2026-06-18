export interface OodaSelectableRunner {
  capabilities?: string[];
}

export function chooseOodaRunnerForCapabilities<T extends OodaSelectableRunner>(
  runners: T[] | undefined,
  requiredCapabilities: string[] = [],
): T | undefined {
  const candidates = runners ?? [];
  if (requiredCapabilities.length === 0) return candidates[0];

  return candidates.find((runner) => {
    const capabilities = new Set(runner.capabilities ?? []);
    return requiredCapabilities.every((capability) =>
      capabilities.has(capability),
    );
  });
}

export function chooseOodaAdapter(
  device: OodaSelectableRunner | undefined,
): string {
  const capabilities = device?.capabilities ?? [];
  return capabilities.includes("claude")
    ? "claude"
    : capabilities.includes("codex")
      ? "codex"
      : capabilities[0] ?? "claude";
}
