import type { DomainAdapter } from "@gmacko/ooda/contracts/v1";
import {
  BizPulseDomainAdapter,
  BobDomainAdapter,
  ObsidianDomainAdapter,
} from "@gmacko/ooda/integrations";

import type { RunnerConfig } from "../config";
import { createBizPulseClient } from "./bizpulse-client";

export function createDeliveryAdapters(
  config: RunnerConfig,
): Map<string, DomainAdapter> {
  const adapters = new Map<string, DomainAdapter>();
  if (
    config.bobDeliveryEnabled &&
    config.bobApiUrl &&
    config.bobApiKey &&
    config.bobWorkspaceId
  ) {
    adapters.set(
      "bob",
      new BobDomainAdapter({
        apiUrl: config.bobApiUrl,
        apiKey: config.bobApiKey,
        workspaceId: config.bobWorkspaceId,
      }),
    );
  }
  if (config.obsidianDeliveryEnabled) {
    adapters.set(
      "obsidian",
      new ObsidianDomainAdapter({
        vaultPath: config.obsidianVaultPath,
        ...(config.obsidianVaultName
          ? { vaultName: config.obsidianVaultName }
          : {}),
      }),
    );
  }
  if (
    config.bizPulseDeliveryEnabled &&
    config.bizPulseApiUrl &&
    config.bizPulseApiKey
  ) {
    adapters.set(
      "bizpulse",
      new BizPulseDomainAdapter({
        apiUrl: config.bizPulseApiUrl,
        client: createBizPulseClient({
          apiUrl: config.bizPulseApiUrl,
          apiKey: config.bizPulseApiKey,
        }),
      }),
    );
  }
  return adapters;
}
