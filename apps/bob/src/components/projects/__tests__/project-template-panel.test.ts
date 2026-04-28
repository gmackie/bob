import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("@bob/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

import { ProjectTemplatePanel } from "../project-template-panel";

const capability = {
  slug: "create-gmacko-app" as const,
  label: "create-gmacko-app",
  confidence: "high" as const,
  frontendApps: ["apps/nextjs"],
  evidence: [
    "apps/nextjs",
    "packages/ui",
    "packages/api",
    "packages/db",
    "docs/ai",
    ".claude/skills/gstack",
    "gmacko.integrations.json",
  ],
  hasAiWorkflow: true,
  hasClaudeGstack: true,
  hasRepoSkill: true,
  hasStorybook: true,
  hasIntegrationManifest: true,
  hasPlaywright: true,
  hasMaestro: true,
};

describe("ProjectTemplatePanel", () => {
  it("renders the command-center experience for feature development", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProjectTemplatePanel, {
        linkedRepository: {
          id: "repo-1",
          name: "acme-app",
          remoteProvider: "github",
        },
        capability,
        planningAction: React.createElement("button", null, "Plan with Bob"),
      }),
    );

    expect(markup).toContain("Recommended next move");
    expect(markup).toContain("Tell Bob");
    expect(markup).toContain("Validation path");
    expect(markup).toContain("Feature development");
    expect(markup).toContain("Plan with Bob");
    expect(markup).toContain("Open repository");
    expect(markup).toContain("Where code goes");
    expect(markup).toContain("Shared UI and stories");
    expect(markup).toContain("Keep helpers close to the layer");
    expect(markup).toContain("Promote code into a package");
    expect(markup).toContain("Playwright");
    expect(markup).toContain("/browse");
    expect(markup).toContain("Maestro");
  });

  it("renders the UI storybook experience when requested", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProjectTemplatePanel, {
        linkedRepository: {
          id: "repo-1",
          name: "acme-app",
          remoteProvider: "github",
        },
        capability,
        initialExperience: "ui-ux",
      }),
    );

    expect(markup).toContain("UI/UX iteration");
    expect(markup).toContain("Generate Storybook coverage");
    expect(markup).toContain("state coverage");
    expect(markup).toContain("packages/ui");
  });
});
