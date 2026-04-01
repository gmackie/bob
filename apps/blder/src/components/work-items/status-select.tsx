"use client";

import { Badge } from "@bob/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bob/ui/select";

import { STATUS_COLOR, formatLabel } from "~/lib/design/colors";

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

interface StatusSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function StatusSelect({
  value,
  onValueChange,
  disabled,
}: StatusSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="h-auto w-auto border-none bg-transparent p-0 shadow-none hover:bg-transparent focus:ring-0">
        <SelectValue>
          <Badge variant={STATUS_COLOR[value] ?? "default"}>
            {formatLabel(value)}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <Badge variant={STATUS_COLOR[s] ?? "default"}>
              {formatLabel(s)}
            </Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
