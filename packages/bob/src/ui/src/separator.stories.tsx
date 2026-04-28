import type { Meta, StoryObj } from "@storybook/react";

import { Separator } from "./separator";

const meta: Meta<typeof Separator> = {
  title: "Primitives/Separator",
  component: Separator,
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p className="text-sm">Section A</p>
      <Separator className="my-4" />
      <p className="text-sm">Section B</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-4">
      <span className="text-sm">Dashboard</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Projects</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Settings</span>
    </div>
  ),
};
