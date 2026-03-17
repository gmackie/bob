import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "outline", "secondary", "ghost", "link"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: "Deploy to staging", variant: "default" },
};

export const Secondary: Story = {
  args: { children: "Cancel", variant: "secondary" },
};

export const Outline: Story = {
  args: { children: "View details", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "View logs", variant: "ghost" },
};

export const Destructive: Story = {
  args: { children: "Delete workspace", variant: "destructive" },
};

export const Link: Story = {
  args: { children: "Learn more", variant: "link" },
};

export const Small: Story = {
  args: { children: "Small", size: "sm" },
};

export const Large: Story = {
  args: { children: "Large", size: "lg" },
};

export const Icon: Story = {
  args: { children: "B", size: "icon" },
};

export const Disabled: Story = {
  args: { children: "Disabled", disabled: true },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Variants</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Sizes</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">B</Button>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-3 text-sm font-medium">Disabled</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
          <Button variant="outline" disabled>Outline</Button>
          <Button variant="destructive" disabled>Destructive</Button>
        </div>
      </div>
    </div>
  ),
};
