import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Badge",
  component: Badge,
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "slate", "blue", "amber", "purple", "emerald", "rose", "orange"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { children: "Default", variant: "default" },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Color Variants</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="slate">Slate</Badge>
          <Badge variant="blue">Blue</Badge>
          <Badge variant="amber">Amber</Badge>
          <Badge variant="purple">Purple</Badge>
          <Badge variant="emerald">Emerald</Badge>
          <Badge variant="rose">Rose</Badge>
          <Badge variant="orange">Orange</Badge>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Work Item Types</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue">Feature</Badge>
          <Badge variant="rose">Bug</Badge>
          <Badge variant="purple">Task</Badge>
          <Badge variant="amber">Chore</Badge>
          <Badge variant="emerald">Epic</Badge>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Status</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="slate">Backlog</Badge>
          <Badge variant="blue">Todo</Badge>
          <Badge variant="amber">In Progress</Badge>
          <Badge variant="purple">In Review</Badge>
          <Badge variant="emerald">Done</Badge>
          <Badge variant="rose">Canceled</Badge>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Build Status</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="slate">Queued</Badge>
          <Badge variant="blue">Running</Badge>
          <Badge variant="emerald">Passed</Badge>
          <Badge variant="rose">Failed</Badge>
        </div>
      </div>
    </div>
  ),
};
