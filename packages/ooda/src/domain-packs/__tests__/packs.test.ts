import { describe, expect, it } from "vitest";

import { getDomainPack, listDomainPacks } from "../packs";

describe("Domain Packs", () => {
  it("returns the general-research pack", () => {
    const pack = getDomainPack("general-research");
    expect(pack).toBeDefined();
    expect(pack!.name).toBe("General Research");
    expect(pack!.sourceBundleIds).toContain("general-research");
  });

  it("returns the biomedical-research pack with warnings", () => {
    const pack = getDomainPack("biomedical-research");
    expect(pack).toBeDefined();
    expect(pack!.sourceBundleIds).toContain("biomedical-discovery");
    expect(pack!.warnings).toContain(
      "Research findings are not clinical advice.",
    );
  });

  it("lists all available domain packs", () => {
    const packs = listDomainPacks();
    expect(packs.length).toBeGreaterThanOrEqual(5);
    expect(packs.map((p) => p.id)).toContain("general-research");
    expect(packs.map((p) => p.id)).toContain("biomedical-research");
  });

  it("returns undefined for unknown pack", () => {
    expect(getDomainPack("nonexistent")).toBeUndefined();
  });
});
