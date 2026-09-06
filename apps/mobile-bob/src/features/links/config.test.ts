import { describe, expect, it, vi } from "vitest";
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
import { resolveExternalLinkConfig } from "./config";
import { buildExternalLink } from "./external-links";

describe("external link configuration", () => {
  it("uses defaults only when values are absent", () => {
    expect(resolveExternalLinkConfig({}).forgegraphWebOrigin).toBe("https://forgegraf.com");
  });
  it("disables malformed configuration instead of stringifying objects", () => {
    const config = resolveExternalLinkConfig({ forgegraphScheme: {}, forgegraphWebOrigin: 42 });
    expect(buildExternalLink({ target: "forgegraph.pullRequests" }, config)).toBeNull();
  });
  it("preserves explicit empty configuration to disable links", () => {
    expect(resolveExternalLinkConfig({ forgegraphScheme: "" }).forgegraphScheme).toBe("");
  });
});
