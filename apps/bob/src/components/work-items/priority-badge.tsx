"use client";

import { Badge } from "@gmacko/core/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gmacko/core/ui/select";

import { PRIORITY_COLOR, formatLabel } from "~/lib/design/colors";

const PRIORITIES = [
  "no_priority",
  "urgent",
  "high",
  "medium",
  "low",
] as const;

interface PriorityBadgeProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function PriorityBadge({
  value,
  onValueChange,
  disabled,
}: PriorityBadgeProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="h-auto w-auto border-none bg-transparent p-0 shadow-none hover:bg-transparent focus:ring-0">
        <SelectValue>
          <Badge variant={PRIORITY_COLOR[value] ?? "default"}>
            {formatLabel(value)}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            <Badge variant={PRIORITY_COLOR[p] ?? "default"}>
              {formatLabel(p)}
            </Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
