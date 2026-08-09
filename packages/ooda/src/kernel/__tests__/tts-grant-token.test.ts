import { describe, expect, it } from "vitest";

import { createTtsGrantToken, hashTtsGrantToken } from "../tts-grant-token";

describe("TTS grant tokens", () => {
  it("derives an opaque, replayable token without embedding the secret", async () => {
    const secret = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- synthetic fixture
    const grantId = "0198-tts-grant";

    const first = await createTtsGrantToken(grantId, secret);
    const replay = await createTtsGrantToken(grantId, secret);

    expect(first).toBe(replay);
    expect(first).toMatch(/^0198-tts-grant\.[A-Za-z0-9_-]+$/);
    expect(first).not.toContain(secret);
    await expect(hashTtsGrantToken(first)).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects secrets too short to protect a public bearer token", async () => {
    await expect(createTtsGrantToken("grant-1", "too-short")).rejects.toThrow(
      "at least 32 bytes",
    );
  });
});
