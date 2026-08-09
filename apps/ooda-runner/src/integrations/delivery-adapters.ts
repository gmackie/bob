import type { DomainAdapter } from "@gmacko/ooda/contracts/v1";
import {
  BizPulseDomainAdapter,
  BobDomainAdapter,
  CreatorDomainAdapter,
  FabForgeDomainAdapter,
  ObsidianDomainAdapter,
} from "@gmacko/ooda/integrations";

import type { RunnerConfig } from "../config";
import { createBizPulseClient } from "./bizpulse-client";
import { createCreatorClient } from "./creator-client";
import { createCreatorScaffolder } from "./creator-scaffolder";
import { createFabForgeClient } from "./fabforge-client";

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
  if (
    config.creatorDeliveryEnabled &&
    config.creatorApiUrl &&
    config.creatorApiKey &&
    config.creatorProjectRoot &&
    config.creatorTemplatePath
  ) {
    adapters.set(
      "creator",
      new CreatorDomainAdapter({
        apiUrl: config.creatorApiUrl,
        projectRoot: config.creatorProjectRoot,
        receiptRoot: config.creatorReceiptRoot,
        client: createCreatorClient({
          apiUrl: config.creatorApiUrl,
          apiKey: config.creatorApiKey,
        }),
        scaffold: createCreatorScaffolder(config.creatorTemplatePath),
      }),
    );
  }
  if (
    config.fabForgeDeliveryEnabled &&
    config.fabForgeApiUrl &&
    config.fabForgeApiToken &&
    config.fabForgeWorkspaceId
  ) {
    adapters.set(
      "fabforge",
      new FabForgeDomainAdapter({
        apiUrl: config.fabForgeApiUrl,
        workspaceId: config.fabForgeWorkspaceId,
        client: createFabForgeClient({
          apiUrl: config.fabForgeApiUrl,
          apiToken: config.fabForgeApiToken,
        }),
      }),
    );
  }
  return adapters;
}
