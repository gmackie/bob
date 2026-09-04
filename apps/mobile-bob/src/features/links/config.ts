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
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

  return {
    forgegraphScheme: String(extra.forgegraphScheme ?? "forgegraph"),
    forgegraphWebOrigin: String(extra.forgegraphWebOrigin ?? "https://forgegraf.com"),
    // KanBanger (linear-clone) ships an Expo app whose scheme is still the
    // default "my-app", so there is no real custom scheme to target yet — the
    // https fallback carries these links until it has one.
    kanbangerScheme: String(extra.kanbangerScheme ?? "kanbanger"),
    kanbangerWebOrigin: String(extra.kanbangerWebOrigin ?? "https://tasks.gmac.io"),
  };
}
