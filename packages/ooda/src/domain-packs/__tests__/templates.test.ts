import { describe, expect, it } from "vitest";

import { getDomainPackTemplate } from "../templates";

describe("getDomainPackTemplate", () => {
  it("returns correct bundles for biomedical-research", () => {
    const template = getDomainPackTemplate("biomedical-research");
    expect(template).toBeDefined();
    expect(template!.sourceBundleIds).toContain("biomedical-discovery");
    expect(template!.sourceBundleIds).toContain("general-research");
  });

  it("returns warnings for biomedical-research", () => {
    const template = getDomainPackTemplate("biomedical-research");
    expect(template).toBeDefined();
    expect(template!.warnings).toContain(
      "Research findings are not clinical advice.",
    );
  });

  it("returns correct bundles for general-research", () => {
    const template = getDomainPackTemplate("general-research");
    expect(template).toBeDefined();
    expect(template!.sourceBundleIds).toEqual(["general-research"]);
    expect(template!.warnings).toEqual([]);
  });

  it("returns undefined for unknown pack", () => {
    expect(getDomainPackTemplate("nonexistent")).toBeUndefined();
  });
});
