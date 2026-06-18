import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "App/Project Card",
};

export default meta;

function ProjectCardDemo({
  label = "Project",
  name,
  color = "#D4850A",
  totals = "12 items",
  activeLabel = "4 active",
  status = "in_progress",
}: {
  label?: string;
  name: string;
  color?: string;
  totals?: string;
  activeLabel?: string;
  status?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 transition hover:border-muted-foreground/30 hover:shadow-md cursor-pointer w-72">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {label}
          </div>
          <h3 className="mt-2 font-display text-lg font-semibold text-foreground">{name}</h3>
        </div>
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <div className="mt-4 text-sm text-secondary-foreground">{totals}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{activeLabel}</span>
        <span>{status.replace(/_/g, " ")}</span>
      </div>
    </div>
  );
}

export const Default: StoryObj = {
  render: () => <ProjectCardDemo name="api-refactor" totals="12 items" activeLabel="4 active · 2 running" />,
};

export const Multiple: StoryObj = {
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      <ProjectCardDemo name="api-refactor" color="#D4850A" totals="12 items" activeLabel="4 active" />
      <ProjectCardDemo name="mobile-auth-flow" color="#A78BFA" totals="7 items" activeLabel="1 active" />
      <ProjectCardDemo name="infra-migration" color="#34D399" totals="23 items" activeLabel="0 active" status="complete" />
    </div>
  ),
};
