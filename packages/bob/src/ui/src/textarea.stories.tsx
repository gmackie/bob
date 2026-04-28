import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import { Textarea } from "./textarea";

const meta: Meta<typeof Textarea> = {
  title: "Primitives/Textarea",
  component: Textarea,
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: "Describe the work item..." },
};

export const WithLabel: Story = {
  render: () => (
    <div className="w-80">
      <Label htmlFor="desc">Description</Label>
      <Textarea id="desc" placeholder="Describe the work item..." className="mt-1.5" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { defaultValue: "This field is locked.", disabled: true },
};
