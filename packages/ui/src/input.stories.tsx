import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "./input";
import { Label } from "./label";

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: "Search workspaces..." },
};

export const WithLabel: Story = {
  render: () => (
    <div className="w-72">
      <Label htmlFor="name">Workspace name</Label>
      <Input id="name" placeholder="e.g., api-refactor" className="mt-1.5" />
      <p className="text-muted-foreground mt-1 text-xs">A short identifier for this workspace.</p>
    </div>
  ),
};

export const WithValue: Story = {
  args: { defaultValue: "api-refactor-v2" },
};

export const Disabled: Story = {
  args: { defaultValue: "locked-workspace", disabled: true },
};

export const Invalid: Story = {
  render: () => (
    <div className="w-72">
      <Label htmlFor="invalid">Workspace name</Label>
      <Input id="invalid" defaultValue="invalid name!" aria-invalid className="mt-1.5" />
      <p className="text-destructive mt-1 text-xs">Workspace name cannot contain special characters.</p>
    </div>
  ),
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-72">
      <div>
        <p className="text-muted-foreground mb-2 text-sm font-medium">Default</p>
        <Input placeholder="Placeholder text" />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-sm font-medium">With value</p>
        <Input defaultValue="api-refactor-v2" />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-sm font-medium">Disabled</p>
        <Input defaultValue="locked-workspace" disabled />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-sm font-medium">Invalid</p>
        <Input defaultValue="bad!" aria-invalid />
      </div>
    </div>
  ),
};
