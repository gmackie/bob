import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectProjectCapabilities } from "../projectCapabilities";

const tempDirs: string[] = [];

function createTempRepo(paths: { path: string; content?: string }[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "bob-project-capabilities-"));
  tempDirs.push(root);

  for (const entry of paths) {
    const absolutePath = path.join(root, entry.path);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (entry.content === undefined) {
      mkdirSync(absolutePath, { recursive: true });
      continue;
    }
    writeFileSync(absolutePath, entry.content, "utf8");
  }

  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectProjectCapabilities", () => {
  it("detects create-gmacko-app repositories with React frontend workflow markers", () => {
    const repoPath = createTempRepo([
      { path: "apps/nextjs/.storybook" },
      { path: "apps/nextjs/playwright.config.ts", content: "export default {};" },
      { path: "apps/expo/.maestro" },
      { path: "packages/ui/src/components" },
      {
        path: "packages/ui/src/components/button.stories.tsx",
        content: "export const Default = {};",
      },
      { path: "packages/api/src" },
      { path: "packages/db/src" },
      { path: "docs/ai" },
      { path: ".claude/skills/gstack" },
      {
        path: ".claude/skills/create-gmacko-app-workflow/SKILL.md",
        content: "# create-gmacko-app-workflow",
      },
      {
        path: "gmacko.integrations.json",
        content: JSON.stringify({ integrations: ["stripe"] }),
      },
    ]);

    const result = detectProjectCapabilities({ repositoryPath: repoPath });

    expect(result.template).toMatchObject({
      slug: "create-gmacko-app",
      hasAiWorkflow: true,
      hasClaudeGstack: true,
      hasRepoSkill: true,
      hasStorybook: true,
      hasIntegrationManifest: true,
      hasPlaywright: true,
      hasMaestro: true,
      frontendApps: ["apps/nextjs"],
    });
    expect(result.template?.evidence).toEqual(
      expect.arrayContaining([
        "apps/nextjs",
        "packages/ui",
        "packages/api",
        "packages/db",
        "docs/ai",
        ".claude/skills/gstack",
        ".claude/skills/create-gmacko-app-workflow/SKILL.md",
        "gmacko.integrations.json",
      ]),
    );
  });

  it("does not detect create-gmacko-app when the frontend app marker is missing", () => {
    const repoPath = createTempRepo([
      { path: "packages/ui/src" },
      { path: "packages/api/src" },
      { path: "packages/db/src" },
      { path: "docs/ai" },
      { path: ".claude/skills/gstack" },
    ]);

    const result = detectProjectCapabilities({ repositoryPath: repoPath });

    expect(result.template).toBeNull();
  });
});
