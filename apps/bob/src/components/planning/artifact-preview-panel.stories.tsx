import type { Meta, StoryObj } from "@storybook/react";

import { ArtifactPreviewPanel } from "./artifact-preview-panel";

const sampleMarkdown = `# Priority System BRD

## Problem Statement
Work items currently lack a priority ranking, making it difficult for agents and humans to decide what to work on next.

## Requirements
1. Each work item gets a \`priority\` field (critical, high, medium, low, no_priority)
2. Board views sort by priority by default
3. Agents use priority when picking the next task

## Success Criteria
- Priority is set on 90%+ of active items within 2 weeks
- Agent task selection correlates with priority ranking
`;

const priorArtifacts = [
  {
    id: "brd-v1",
    title: "BRD v1 (Draft)",
    content: "Earlier draft with fewer requirements...",
    createdAt: "2026-03-20T10:00:00Z",
  },
  {
    id: "task-breakdown",
    title: "Task Breakdown",
    content: "1. Add priority field to schema\n2. Update board UI\n3. Agent selection logic",
    createdAt: "2026-03-21T14:00:00Z",
  },
];

const meta: Meta<typeof ArtifactPreviewPanel> = {
  title: "Planning/ArtifactPreviewPanel",
  component: ArtifactPreviewPanel,
  args: {
    liveContent: null,
    priorArtifacts: [],
    isSessionActive: true,
    onContentEdit: () => {},
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ArtifactPreviewPanel>;

/** Empty state — session is active but no content yet (thinking indicator). */
export const Empty: Story = {};

/** Live content streaming in during an active session. */
export const WithLiveContent: Story = {
  args: {
    liveContent: sampleMarkdown,
    isSessionActive: true,
  },
};

/** Session completed with prior artifact tabs available. */
export const WithPriorArtifacts: Story = {
  args: {
    liveContent: sampleMarkdown,
    priorArtifacts,
    isSessionActive: false,
  },
};

/** Session completed — edit button visible (click "Edit artifact" to toggle). */
export const EditableAfterSession: Story = {
  args: {
    liveContent: sampleMarkdown,
    priorArtifacts: [],
    isSessionActive: false,
  },
};
