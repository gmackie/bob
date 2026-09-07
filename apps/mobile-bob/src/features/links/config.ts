import Constants from "expo-constants";

import type { ExternalLinkConfig } from "./external-links";

/**
 * Where the sibling apps live.
 *
 * Read from Expo config extra so a build can point at staging without a code
 * change. An app left unconfigured produces no links at all rather than links
 * that fail — see buildExternalLink.
 */
export function useExternalLinkConfig(): ExternalLinkConfig {
  return resolveExternalLinkConfig(Constants.expoConfig?.extra ?? {});
}

function configuredString(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return typeof value === "string" ? value.trim() : "";
}

export function resolveExternalLinkConfig(extra: Record<string, unknown>): ExternalLinkConfig {

  return {
    forgegraphScheme: configuredString(extra.forgegraphScheme, "forgegraph"),
    forgegraphWebOrigin: configuredString(extra.forgegraphWebOrigin, "https://forgegraf.com"),
    // KanBanger (linear-clone) ships an Expo app whose scheme is still the
    // default "my-app", so there is no real custom scheme to target yet — the
    // https fallback carries these links until it has one.
    kanbangerScheme: configuredString(extra.kanbangerScheme, "kanbanger"),
    kanbangerWebOrigin: configuredString(extra.kanbangerWebOrigin, "https://tasks.gmac.io"),
  };
}
