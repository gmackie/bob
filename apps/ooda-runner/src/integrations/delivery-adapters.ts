import type { DomainAdapter } from "@gmacko/ooda/contracts/v1";
import {
  BizPulseDomainAdapter,
  BobDomainAdapter,
  CreatorDomainAdapter,
  FabForgeDomainAdapter,
  ObsidianDomainAdapter,
  PreflightDomainAdapter,
  VeritasDomainAdapter,
} from "@gmacko/ooda/integrations";

import type { RunnerConfig } from "../config";
import { createBizPulseClient } from "./bizpulse-client";
import { createCreatorClient } from "./creator-client";
import { createCreatorScaffolder } from "./creator-scaffolder";
import { createFabForgeClient } from "./fabforge-client";
import { createPreflightClient } from "./preflight-client";
import { createVeritasClient } from "./veritas-client";

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
  if (config.obsidianDeliveryEnabled && config.obsidianVaultPath) {
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
  if (
    config.veritasDeliveryEnabled &&
    config.veritasApiUrl &&
    config.veritasApiToken
  ) {
    adapters.set(
      "veritas",
      new VeritasDomainAdapter({
        apiUrl: config.veritasApiUrl,
        client: createVeritasClient({
          apiUrl: config.veritasApiUrl,
          apiToken: config.veritasApiToken,
        }),
      }),
    );
  }
  if (
    config.preflightDeliveryEnabled &&
    config.preflightApiUrl &&
    config.preflightApiToken &&
    config.preflightWorkspaceId
  ) {
    adapters.set(
      "preflight",
      new PreflightDomainAdapter({
        apiUrl: config.preflightApiUrl,
        workspaceId: config.preflightWorkspaceId,
        receiptRoot: config.preflightReceiptRoot,
        client: createPreflightClient({
          apiUrl: config.preflightApiUrl,
          apiToken: config.preflightApiToken,
        }),
      }),
    );
  }
  return adapters;
}
