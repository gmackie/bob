"use client";

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bob/ui/select";

interface WorkspaceSelectorProps {
  workspaces: Array<{ id: string; name: string; slug: string }>;
  currentId: string;
}

export function WorkspaceSelector({
  workspaces,
  currentId,
}: WorkspaceSelectorProps) {
  const router = useRouter();

  if (workspaces.length <= 1) {
    return (
      <span className="text-sm text-muted-foreground">
        {workspaces[0]?.name ?? "Workspace"}
      </span>
    );
  }

  return (
    <Select
      value={currentId}
      onValueChange={(id) => router.push(`/planning?workspace=${id}`)}
    >
      <SelectTrigger className="h-8 w-[200px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((ws) => (
          <SelectItem key={ws.id} value={ws.id}>
            {ws.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
