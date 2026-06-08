import { describe, expect, it } from "vitest";

import { formatDeviceApiKeyName, parseDeviceCodeRequest } from "./device-label";

describe("device code request metadata", () => {
  it("uses a default CLI label for empty requests", async () => {
    const request = new Request("https://bob.example.com/api/v1/device/code", {
      method: "POST",
    });

    await expect(parseDeviceCodeRequest(request)).resolves.toEqual({
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

    await expect(parseDeviceCodeRequest(request)).resolves.toEqual({
      deviceName: "Whisplay Bob handheld",
    });
  });

  it("formats visible API key names from device labels", () => {
    expect(formatDeviceApiKeyName("Whisplay Bob handheld", 1710000000000)).toBe(
      "Whisplay Bob handheld - 1710000000000",
    );
  });
});
