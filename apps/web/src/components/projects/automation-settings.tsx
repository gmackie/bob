"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@bob/ui/toast";

import { useTRPC } from "~/trpc/react";
import type { WorkflowStage } from "~/lib/workflow/stage";
import { STAGES } from "~/lib/workflow/stage";

interface StageSkillMapping {
  [stage: string]: { slug: string; label: string; enabled: boolean }[];
}

interface AutomationSettingsProps {
  projectId: string;
  initialSettings?: {
    autoDispatch?: boolean;
    autoBranch?: boolean;
    autoFeaturePR?: boolean;
    ciTrigger?: boolean;
    stageSkills?: StageSkillMapping;
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

/** Default skill mapping per workflow stage. */
const DEFAULT_STAGE_SKILLS: Record<
  WorkflowStage,
  { slug: string; label: string }[]
> = {
  idea: [{ slug: "brainstorm", label: "/brainstorm" }],
  shape: [{ slug: "plan-ceo-review", label: "/plan-ceo-review" }],
  plan: [{ slug: "plan-eng-review", label: "/plan-eng-review" }],
  execute: [{ slug: "tdd", label: "/tdd" }],
  review: [
    { slug: "review", label: "/review" },
    { slug: "qa", label: "/qa" },
  ],
  deploy: [{ slug: "ship", label: "/ship" }],
  live: [{ slug: "retro", label: "/retro" }],
};

function buildInitialStageSkills(
  saved?: StageSkillMapping,
): StageSkillMapping {
  const result: StageSkillMapping = {};
  for (const stage of STAGES) {
    const defaults = DEFAULT_STAGE_SKILLS[stage.key] ?? [];
    const savedStage = saved?.[stage.key];
    result[stage.key] = defaults.map((d) => {
      const savedSkill = savedStage?.find((s) => s.slug === d.slug);
      return {
        slug: d.slug,
        label: d.label,
        enabled: savedSkill ? savedSkill.enabled : true,
      };
    });
  }
  return result;
}

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

  const [stageSkills, setStageSkills] = useState<StageSkillMapping>(() =>
    buildInitialStageSkills(initialSettings?.stageSkills),
  );

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

  function handleSkillToggle(
    stageKey: string,
    skillSlug: string,
    enabled: boolean,
  ) {
    setStageSkills((prev) => {
      const next = { ...prev };
      next[stageKey] = (prev[stageKey] ?? []).map((s) =>
        s.slug === skillSlug ? { ...s, enabled } : s,
      );
      return next;
    });
    // Persist the full stageSkills mapping
    const updated = { ...stageSkills };
    updated[stageKey] = (stageSkills[stageKey] ?? []).map((s) =>
      s.slug === skillSlug ? { ...s, enabled } : s,
    );
    updateSettings.mutate({
      projectId,
      settings: { stageSkills: updated },
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

      {/* Stage Skills Section */}
      <h3 className="mt-10 font-display text-lg font-bold text-foreground">
        Stage Skills
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure which skills run at each workflow stage
      </p>

      <div className="mt-6 space-y-4">
        {STAGES.map((stage) => {
          const skills = stageSkills[stage.key] ?? [];
          if (skills.length === 0) return null;
          return (
            <div
              key={stage.key}
              className="rounded-xl border border-border bg-card px-5 py-4"
            >
              <p className="mb-3 text-sm font-semibold capitalize text-foreground">
                {stage.label}
              </p>
              <div className="space-y-2">
                {skills.map((skill) => (
                  <div
                    key={skill.slug}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="font-mono text-sm text-muted-foreground">
                      {skill.label}
                    </span>
                    <ToggleSwitch
                      checked={skill.enabled}
                      onChange={(val) =>
                        handleSkillToggle(stage.key, skill.slug, val)
                      }
                      disabled={updateSettings.isPending}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
