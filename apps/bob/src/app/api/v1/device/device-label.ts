const DEFAULT_DEVICE_NAME = "Bob CLI";
const MAX_DEVICE_NAME_LENGTH = 80;

export async function parseDeviceCodeRequest(
  request: Request,
): Promise<{ deviceName: string }> {
  if (!request.body) {
    return { deviceName: DEFAULT_DEVICE_NAME };
  }

  try {
    const body = (await request.json()) as { deviceName?: unknown };
    return { deviceName: normalizeDeviceName(body.deviceName) };
  } catch {
    return { deviceName: DEFAULT_DEVICE_NAME };
  }
}

export function normalizeDeviceName(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_DEVICE_NAME;
  }
  const normalized = value.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return normalized || DEFAULT_DEVICE_NAME;
}

export function formatDeviceApiKeyName(
  deviceName: unknown,
  timestamp: number = Date.now(),
): string {
  return `${normalizeDeviceName(deviceName)} - ${timestamp}`;
}
