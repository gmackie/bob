/**
 * ForgeGraph configuration and client factory.
 */

import { ForgeGraphClient } from "./forgeGraphClient";

export interface ForgeGraphConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs: number;
}

export function getForgeGraphConfig(): ForgeGraphConfig | null {
  const apiToken = process.env.FG_API_TOKEN;
  if (!apiToken) return null;

  return {
    baseUrl: process.env.FG_API_URL ?? "https://forge.gmac.io",
    apiToken,
    timeoutMs: parseInt(process.env.FG_TIMEOUT_MS ?? "15000", 10),
  };
}

export function isForgeGraphEnabled(): boolean {
  return !!process.env.FG_API_TOKEN;
}

let _client: ForgeGraphClient | null = null;

/**
 * Returns the ForgeGraph client singleton, or null if not configured.
 */
export function getForgeGraphClient(): ForgeGraphClient | null {
  if (_client) return _client;
  const config = getForgeGraphConfig();
  if (!config) return null;
  _client = new ForgeGraphClient(config);
  return _client;
}

/**
 * Returns the ForgeGraph client, throwing if not configured.
 */
export function requireForgeGraphClient(): ForgeGraphClient {
  const client = getForgeGraphClient();
  if (!client) {
    throw new Error("ForgeGraph not configured: set FG_API_TOKEN env var");
  }
  return client;
}
