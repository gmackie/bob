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
});
