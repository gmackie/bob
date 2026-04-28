import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export interface CreateGmackoAppCapability {
  slug: "create-gmacko-app";
  label: string;
  confidence: "high";
  frontendApps: string[];
  evidence: string[];
  hasAiWorkflow: boolean;
  hasClaudeGstack: boolean;
  hasRepoSkill: boolean;
  hasStorybook: boolean;
  hasIntegrationManifest: boolean;
  hasPlaywright: boolean;
  hasMaestro: boolean;
}

export interface ProjectCapabilities {
  template: CreateGmackoAppCapability | null;
}

const FRONTEND_APP_MARKERS = ["apps/nextjs", "apps/tanstack-start"] as const;
const CORE_PACKAGE_MARKERS = ["packages/ui", "packages/api", "packages/db"] as const;
const PLAYWRIGHT_MARKERS = [
  "apps/nextjs/playwright.config.ts",
  "apps/nextjs/playwright.config.tsx",
  "apps/tanstack-start/playwright.config.ts",
  "apps/tanstack-start/playwright.config.tsx",
] as const;
const MAESTRO_MARKERS = ["apps/expo/.maestro", "apps/expo/package.json"] as const;

function hasPath(repositoryPath: string, relativePath: string): boolean {
  return existsSync(path.join(repositoryPath, relativePath));
}

function hasStoryFile(directoryPath: string): boolean {
  if (!existsSync(directoryPath)) {
    return false;
  }

  const stack = [directoryPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(".stories.")) {
        return true;
      }
    }
  }

  return false;
}

export function detectProjectCapabilities(input: {
  repositoryPath: string | null | undefined;
}): ProjectCapabilities {
  const repositoryPath = input.repositoryPath;
  if (!repositoryPath || !existsSync(repositoryPath)) {
    return { template: null };
  }

  const frontendApps = FRONTEND_APP_MARKERS.filter((marker) =>
    hasPath(repositoryPath, marker),
  );
  const hasCorePackages = CORE_PACKAGE_MARKERS.every((marker) =>
    hasPath(repositoryPath, marker),
  );
  const hasAiWorkflow = hasPath(repositoryPath, "docs/ai");
  const hasClaudeGstack = hasPath(repositoryPath, ".claude/skills/gstack");
  const hasRepoSkill = hasPath(
    repositoryPath,
    ".claude/skills/create-gmacko-app-workflow/SKILL.md",
  );
  const hasIntegrationManifest = hasPath(
    repositoryPath,
    "gmacko.integrations.json",
  );
  const detectedPlaywrightMarkers = PLAYWRIGHT_MARKERS.filter((marker) =>
    hasPath(repositoryPath, marker),
  );
  const detectedMaestroMarkers = MAESTRO_MARKERS.filter((marker) =>
    hasPath(repositoryPath, marker),
  );
  const hasPlaywright = detectedPlaywrightMarkers.length > 0;
  const hasMaestro = detectedMaestroMarkers.length > 0;
  const hasStorybook =
    frontendApps.some((frontendApp) =>
      hasPath(repositoryPath, path.join(frontendApp, ".storybook")),
    ) || hasStoryFile(path.join(repositoryPath, "packages/ui/src"));

  const hasWorkflowSignals =
    hasAiWorkflow || hasClaudeGstack || hasRepoSkill || hasIntegrationManifest;

  if (frontendApps.length === 0 || !hasCorePackages || !hasWorkflowSignals) {
    return { template: null };
  }

  const evidence = [
    ...frontendApps,
    ...CORE_PACKAGE_MARKERS,
    ...(hasAiWorkflow ? ["docs/ai"] : []),
    ...(hasClaudeGstack ? [".claude/skills/gstack"] : []),
    ...(hasRepoSkill
      ? [".claude/skills/create-gmacko-app-workflow/SKILL.md"]
      : []),
    ...(hasIntegrationManifest ? ["gmacko.integrations.json"] : []),
    ...detectedPlaywrightMarkers,
    ...detectedMaestroMarkers,
  ];

  return {
    template: {
      slug: "create-gmacko-app",
      label: "create-gmacko-app",
      confidence: "high",
      frontendApps: [...frontendApps],
      evidence,
      hasAiWorkflow,
      hasClaudeGstack,
      hasRepoSkill,
      hasStorybook,
      hasIntegrationManifest,
      hasPlaywright,
      hasMaestro,
    },
  };
}
