const DEFAULT_DEVICE_NAME = "Bob device";
const DEFAULT_STATE = "unknown";
const MAX_DEVICE_NAME_LENGTH = 100;
const MAX_STATE_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 500;
const MAX_WIFI_LENGTH = 160;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export interface DeviceHeartbeatPayload {
  deviceName: string;
  state: string;
  message: string;
  wifi: string | null;
  batteryPercent: number | null;
  details: Record<string, unknown>;
}

export function normalizeDeviceHeartbeatPayload(
  value: unknown,
): DeviceHeartbeatPayload {
  const body = isRecord(value) ? value : {};

  return {
    deviceName: normalizeText(
      body.deviceName,
      DEFAULT_DEVICE_NAME,
      MAX_DEVICE_NAME_LENGTH,
    ),
    state: normalizeText(body.state, DEFAULT_STATE, MAX_STATE_LENGTH),
    message: normalizeText(body.message, "", MAX_MESSAGE_LENGTH),
    wifi:
      typeof body.wifi === "string"
        ? normalizeText(body.wifi, "", MAX_WIFI_LENGTH) || null
        : null,
    batteryPercent: normalizeBatteryPercent(body.batteryPercent),
    details: isPlainDetails(body.details) ? body.details : {},
  };
}

export function isDeviceOnline(
  lastSeenAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return now.getTime() - lastSeen < ONLINE_WINDOW_MS;
}

function normalizeText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function normalizeBatteryPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainDetails(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
