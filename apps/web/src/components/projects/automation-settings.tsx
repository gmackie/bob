"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@bob/ui/toast";

import { useTRPC } from "~/trpc/react";

interface AutomationSettingsProps {
  projectId: string;
  initialSettings?: {
    autoDispatch?: boolean;
    autoBranch?: boolean;
    autoFeaturePR?: boolean;
    ciTrigger?: boolean;
  };
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
      <div className="space-y-0.5">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const TOGGLE_CONFIG = [
  {
    key: "autoDispatch" as const,
    label: "Auto-dispatch",
    description:
      "Automatically assign an agent when a task moves to 'In Progress'",
  },
  {
    key: "autoBranch" as const,
    label: "Auto-branch",
    description:
      "Create a git branch automatically when an agent session starts",
  },
  {
    key: "autoFeaturePR" as const,
    label: "Auto-feature PR",
    description:
      "Combine task PRs into a feature PR when all tasks are done",
  },
  {
    key: "ciTrigger" as const,
    label: "CI trigger",
    description: "Run CI pipeline automatically when a PR is created",
  },
];

export function AutomationSettings({
  projectId,
  initialSettings,
}: AutomationSettingsProps) {
  const trpc = useTRPC();

  const [settings, setSettings] = useState<{
    autoDispatch: boolean;
    autoBranch: boolean;
    autoFeaturePR: boolean;
    ciTrigger: boolean;
  }>({
    autoDispatch: initialSettings?.autoDispatch ?? true,
    autoBranch: initialSettings?.autoBranch ?? true,
    autoFeaturePR: initialSettings?.autoFeaturePR ?? true,
    ciTrigger: initialSettings?.ciTrigger ?? true,
  });

  const updateSettings = useMutation(
    trpc.project.updateAutomationSettings.mutationOptions({
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  function handleToggle(
    key: "autoDispatch" | "autoBranch" | "autoFeaturePR" | "ciTrigger",
    value: boolean,
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    updateSettings.mutate({
      projectId,
      settings: { [key]: value },
    });
  }

  return (
    <div>
      <h3 className="font-display text-lg font-bold text-foreground">
        Automation
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Control how Bob automates work in this project
      </p>

      <div className="mt-6 space-y-3">
        {TOGGLE_CONFIG.map((toggle) => (
          <ToggleRow
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={settings[toggle.key]}
            onChange={(value) => handleToggle(toggle.key, value)}
            disabled={updateSettings.isPending}
          />
        ))}
      </div>
    </div>
  );
}
