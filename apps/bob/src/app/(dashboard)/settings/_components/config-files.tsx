"use client";
export function ConfigFilesSection() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium text-foreground">No config files yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        MCP servers, skill definitions, and agent configs will appear here once
        you run <code className="font-mono">bob init</code> in a workspace.
      </p>
    </div>
  );
}
