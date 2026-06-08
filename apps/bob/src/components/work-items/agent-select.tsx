"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gmacko/core/ui/select";

import { getAvailableAgentTypes } from "~/utils/platform";

const INHERIT = "__inherit__";

interface AgentSelectProps {
  /** Current agent value; null/undefined means "inherit the default". */
  value: string | null | undefined;
  /** Called with the selected agent, or null when "inherit" is chosen. */
  onValueChange: (value: string | null) => void;
  disabled?: boolean;
  /**
   * Whether to offer the "inherit" option. Work item + project selectors set
   * this true (they fall back up the hierarchy); the workspace selector also
   * allows it (null = no workspace default → "claude" fallback).
   */
  allowInherit?: boolean;
  /** Label for the inherit option, e.g. "Use project default". */
  inheritLabel?: string;
}

/**
 * Agent picker shared by the work-item / project / workspace agent-selection
 * surfaces. Options come from the single `getAvailableAgentTypes` source (which
 * includes Grok), so adding an agent updates every picker at once.
 */
export function AgentSelect({
  value,
  onValueChange,
  disabled,
  allowInherit = true,
  inheritLabel = "Inherit default",
}: AgentSelectProps) {
  const agents = getAvailableAgentTypes();
  return (
    <Select
      value={value ?? INHERIT}
      onValueChange={(v) => onValueChange(v === INHERIT ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowInherit && (
          <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        )}
        {agents.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            {a.icon} {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
