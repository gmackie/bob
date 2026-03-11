import type { AppConfig } from "./types";

let cachedConfig: AppConfig | null = null;

export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/config`);
    if (!response.ok) {
      throw new Error("Failed to fetch app config");
    }

    cachedConfig = await response.json();
    return cachedConfig!;
  } catch (error) {
    console.error("Failed to load app config, using defaults:", error);
    cachedConfig = {
      appName: "Bob",
      enableGithubAuth: false,
      jeffMode: false,
      allowedAgents: [],
    };
    return cachedConfig;
  }
}

export function clearAppConfigCache(): void {
  cachedConfig = null;
}

export function getApiBase(): string {
  // When using Next.js API routes, use relative URLs
  // Fall back to legacy backend URL if BACKEND_URL is explicitly set
  if (typeof window === "undefined") {
    // Server-side: use explicit backend URL if set, otherwise use relative path
    return process.env.BACKEND_URL ?? "";
  }
  // Client-side: use explicit URL if set, otherwise use relative path (same origin)
  return process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
}

export function getWsBase(): string {
  // Prefer an explicit WS base when deploying behind proxies.
  const explicit = process.env.NEXT_PUBLIC_WS_BASE;
  if (explicit) {
    return explicit.endsWith("/ws") ? explicit : `${explicit}/ws`;
  }

  const apiBase = getApiBase();
  if (apiBase) {
    const wsBase = apiBase.replace(/^http/, "ws");
    return wsBase.endsWith("/ws") ? wsBase : `${wsBase}/ws`;
  }

  // Same-origin default (works for hosted domains and local dev).
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }

  return "";
}
