import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardFooter, CardHeader } from "./card";

const meta: Meta<typeof Card> = {
  title: "Primitives/Card",
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <h3 className="font-display text-lg font-semibold">api-refactor</h3>
        <p className="text-muted-foreground text-sm">
          Refactoring the tRPC router layer to support batch operations.
        </p>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-muted-foreground text-xs">
          4 tasks · 2 running · Updated 3m ago
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Open</Button>
        <Button variant="ghost" size="sm">Archive</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithBadges: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold">WI-0016</h3>
          <Badge variant="purple">Task</Badge>
          <Badge variant="amber">In Progress</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Migrate DB schema for work item priorities
        </p>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-muted-foreground text-xs">
          Priority: Urgent · Created Mar 15
        </p>
      </CardContent>
    </Card>
  ),
};

export const Minimal: Story = {
  render: () => (
    <Card className="w-64">
      <CardContent className="pt-6">
        <p className="text-sm">A simple card with just content.</p>
      </CardContent>
    </Card>
  ),
};
