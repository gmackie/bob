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
    // No default: Kanbanger's host is not yet known to this app, and guessing
    // one would ship links that 404. Set `kanbangerWebOrigin` in app config to
    // turn these on.
    kanbangerScheme: String(extra.kanbangerScheme ?? "kanbanger"),
    kanbangerWebOrigin: String(extra.kanbangerWebOrigin ?? ""),
  };
}
