import type { Meta, StoryObj } from "@storybook/react";

import { ResizableSplitView } from "./resizable-split-view";

const LeftPanel = () => (
  <div className="flex h-full flex-col bg-background p-4">
    <h2 className="mb-2 text-sm font-semibold text-foreground">Chat Panel</h2>
    <div className="flex-1 space-y-3 overflow-y-auto">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Message {i + 1} — Lorem ipsum dolor sit amet, consectetur adipiscing elit.
        </div>
      ))}
    </div>
  </div>
);

const RightPanel = () => (
  <div className="flex h-full flex-col bg-card p-4">
    <h2 className="mb-2 text-sm font-semibold text-foreground">Artifact Preview</h2>
    <div className="flex-1 rounded-md border border-border p-4 text-sm text-muted-foreground">
      Preview content appears here as artifacts are generated.
    </div>
  </div>
);

const meta: Meta<typeof ResizableSplitView> = {
  title: "Planning/ResizableSplitView",
  component: ResizableSplitView,
  args: {
    left: <LeftPanel />,
    right: <RightPanel />,
    storageKey: "storybook-split-ratio",
    defaultRatio: 0.6,
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

type Story = StoryObj<typeof ResizableSplitView>;

export const Default: Story = {};

export const EvenSplit: Story = {
  args: {
    defaultRatio: 0.5,
    storageKey: "storybook-split-even",
  },
};

export const LeftHeavy: Story = {
  args: {
    defaultRatio: 0.75,
    storageKey: "storybook-split-left-heavy",
  },
};

export const NarrowRange: Story = {
  args: {
    defaultRatio: 0.5,
    minRatio: 0.4,
    maxRatio: 0.6,
    storageKey: "storybook-split-narrow",
  },
};
