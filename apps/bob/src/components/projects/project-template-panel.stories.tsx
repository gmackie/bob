import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@gmacko/core/ui/button";

import { ProjectTemplatePanel } from "./project-template-panel";

const meta: Meta<typeof ProjectTemplatePanel> = {
  title: "App/Create Gmacko App Command Center",
  component: ProjectTemplatePanel,
  args: {
    linkedRepository: {
      id: "repo-1",
      name: "playpath-web",
      remoteProvider: "github",
    },
    capability: {
      slug: "create-gmacko-app",
      label: "create-gmacko-app",
      confidence: "high",
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
    },
    planningAction: <Button variant="outline">Plan with Bob</Button>,
  },
};

export default meta;

type Story = StoryObj<typeof ProjectTemplatePanel>;

export const FeatureDevelopment_FullSignals: Story = {
  args: {
    initialExperience: "feature-development",
  },
};

export const UIUXIteration_StorybookFocused: Story = {
  args: {
    initialExperience: "ui-ux",
  },
};

export const IntegrationDelivery_EcosystemAware: Story = {
  args: {
    initialExperience: "integration-delivery",
  },
};

export const ProductionResponse_IncidentTriage: Story = {
  args: {
    initialExperience: "production-response",
  },
};

export const FeatureDevelopment_MinimalSignals: Story = {
  args: {
    initialExperience: "feature-development",
    capability: {
      slug: "create-gmacko-app",
      label: "create-gmacko-app",
      confidence: "high",
      frontendApps: ["apps/tanstack-start"],
      evidence: [
        "apps/tanstack-start",
        "packages/ui",
        "packages/api",
        "packages/db",
      ],
      hasAiWorkflow: false,
      hasClaudeGstack: false,
      hasRepoSkill: false,
      hasStorybook: false,
      hasIntegrationManifest: false,
      hasPlaywright: false,
      hasMaestro: false,
    },
  },
};
