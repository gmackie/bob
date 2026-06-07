import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDeviceApiKeyName, parseDeviceCodeRequest } from "./device-label";

describe("device code request metadata", () => {
  it("uses a default CLI label for empty requests", async () => {
    const request = new Request("https://bob.example.com/api/v1/device/code", {
      method: "POST",
    });

    assert.deepEqual(await parseDeviceCodeRequest(request), {
      deviceName: "Bob CLI",
    });
  });

  it("accepts a bounded device name from JSON", async () => {
    const request = new Request("https://bob.example.com/api/v1/device/code", {
      method: "POST",
      body: JSON.stringify({
        deviceName: "  Whisplay Bob handheld  ",
      }),
    });

    assert.deepEqual(await parseDeviceCodeRequest(request), {
      deviceName: "Whisplay Bob handheld",
    });
  });

  it("formats visible API key names from device labels", () => {
    assert.equal(
      formatDeviceApiKeyName("Whisplay Bob handheld", 1710000000000),
      "Whisplay Bob handheld - 1710000000000",
    );
  });
});
