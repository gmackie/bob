export interface RunnerDevice {
  id?: string;
  capabilities?: string[] | null;
}

export function chooseRunnerForCapabilities(
  devices: RunnerDevice[],
  requiredCapabilities: string[] = [],
): RunnerDevice | undefined {
  if (requiredCapabilities.length === 0) return devices[0];

  return devices.find((device) => {
    const capabilities = new Set(device.capabilities ?? []);
    return requiredCapabilities.every((capability) =>
      capabilities.has(capability),
    );
  });
}

export function chooseDefaultAdapter(device: RunnerDevice | undefined): string {
  const capabilities = device?.capabilities ?? [];
  return capabilities.includes("claude")
    ? "claude"
    : capabilities.includes("codex")
      ? "codex"
      : capabilities[0] ?? "claude";
}
