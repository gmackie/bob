export interface RunnerDevice {
  id?: string;
  capabilities?: string[] | null;
}

export function chooseDefaultAdapter(device: RunnerDevice | undefined): string {
  const capabilities = device?.capabilities ?? [];
  return capabilities.includes("claude")
    ? "claude"
    : capabilities.includes("codex")
      ? "codex"
      : capabilities[0] ?? "claude";
}
