import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@bob/ui/badge";

const meta: Meta = {
  title: "App/Command Palette",
};

export default meta;

function CommandPaletteDemo({ query, results }: {
  query?: string;
  results?: { kind: string; kindVariant: "blue" | "amber" | "purple"; identifier: string; title: string }[];
}) {
  return (
    <div className="w-[520px] rounded-2xl border border-border bg-popover shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="text-muted-foreground">&#128269;</span>
        <input
          readOnly
          value={query ?? ""}
          placeholder="Search work items..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">
        {!query ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Type to search work items...
          </div>
        ) : results && results.length > 0 ? (
          results.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent cursor-pointer"
            >
              <Badge variant={item.kindVariant} className="shrink-0 px-1.5 py-0 text-[10px]">
                {item.kind}
              </Badge>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.identifier}</span>
              <span className="truncate text-foreground">{item.title}</span>
            </div>
          ))
        ) : (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}

export const Empty: StoryObj = {
  render: () => <CommandPaletteDemo />,
};

export const WithResults: StoryObj = {
  render: () => (
    <CommandPaletteDemo
      query="migrate"
      results={[
        { kind: "task", kindVariant: "amber", identifier: "WI-0016", title: "Migrate DB schema for work item priorities" },
        { kind: "task", kindVariant: "amber", identifier: "WI-0031", title: "Migrate auth sessions to new token format" },
        { kind: "issue", kindVariant: "blue", identifier: "WI-0042", title: "Migration rollback fails on empty tables" },
      ]}
    />
  ),
};

export const NoResults: StoryObj = {
  render: () => <CommandPaletteDemo query="xyznonexistent" results={[]} />,
};
