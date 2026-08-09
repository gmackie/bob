import { describe, expect, it } from "vitest";

import { RunnerConfigSchema } from "../../config";
import { createDeliveryAdapters } from "../delivery-adapters";

describe("createDeliveryAdapters", () => {
  it("registers BizPulse only when its kill switch and credentials are present", () => {
    const disabled = createDeliveryAdapters(RunnerConfigSchema.parse({}));
    const incomplete = createDeliveryAdapters(
      RunnerConfigSchema.parse({ bizPulseDeliveryEnabled: true }),
    );
    const enabled = createDeliveryAdapters(
      RunnerConfigSchema.parse({
        bizPulseDeliveryEnabled: true,
        bizPulseApiUrl: "https://bizpulse.example",
        bizPulseApiKey: "biz_private_key",
      }),
    );

    expect([...disabled.keys()]).not.toContain("bizpulse");
    expect([...incomplete.keys()]).not.toContain("bizpulse");
    expect([...enabled.keys()]).toContain("bizpulse");
  });

  it("registers Creator only when its kill switch, credentials, and paths are present", () => {
    const disabled = createDeliveryAdapters(RunnerConfigSchema.parse({}));
    const incomplete = createDeliveryAdapters(
      RunnerConfigSchema.parse({ creatorDeliveryEnabled: true }),
    );
    const enabled = createDeliveryAdapters(
      RunnerConfigSchema.parse({
        creatorDeliveryEnabled: true,
        creatorApiUrl: "https://creator.example",
        creatorApiKey: "gmk_creator_key",
        creatorProjectRoot: "/tmp/creator-projects",
        creatorTemplatePath: "/tmp/create-gmacko-video",
        creatorReceiptRoot: "/tmp/creator-receipts",
      }),
    );

    expect([...disabled.keys()]).not.toContain("creator");
    expect([...incomplete.keys()]).not.toContain("creator");
    expect([...enabled.keys()]).toContain("creator");
  });

  it("registers FabForge only when its kill switch, token, and workspace are present", () => {
    const disabled = createDeliveryAdapters(RunnerConfigSchema.parse({}));
    const incomplete = createDeliveryAdapters(
      RunnerConfigSchema.parse({ fabForgeDeliveryEnabled: true }),
    );
    const enabled = createDeliveryAdapters(
      RunnerConfigSchema.parse({
        fabForgeDeliveryEnabled: true,
        fabForgeApiUrl: "https://fabforge.example",
        fabForgeApiToken: "fft_ooda_token",
        fabForgeWorkspaceId: "workspace-1",
      }),
    );

    expect([...disabled.keys()]).not.toContain("fabforge");
    expect([...incomplete.keys()]).not.toContain("fabforge");
    expect([...enabled.keys()]).toContain("fabforge");
  });
});
