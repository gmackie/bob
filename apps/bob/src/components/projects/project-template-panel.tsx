"use client";

import React, { useState } from "react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

interface LinkedRepository {
  id?: string;
  name: string;
  remoteProvider?: string | null;
}

interface CreateGmackoAppCapability {
  slug: "create-gmacko-app";
  label: string;
  confidence: "high";
  frontendApps: string[];
  evidence: string[];
  hasAiWorkflow: boolean;
  hasClaudeGstack: boolean;
  hasRepoSkill: boolean;
  hasStorybook: boolean;
  hasIntegrationManifest: boolean;
  hasPlaywright: boolean;
  hasMaestro: boolean;
}

interface ProjectTemplatePanelProps {
  linkedRepository: LinkedRepository | null;
  capability: CreateGmackoAppCapability;
  planningAction?: React.ReactNode;
  initialExperience?: ExperienceKey;
}

type ExperienceKey =
  | "feature-development"
  | "ui-ux"
  | "integration-delivery"
  | "production-response";

const EXPERIENCE_ORDER: ExperienceKey[] = [
  "feature-development",
  "ui-ux",
  "integration-delivery",
  "production-response",
];

const EXPERIENCE_CONTENT: Record<
  ExperienceKey,
  {
    label: string;
    summary: string;
    recommendedTitle: string;
    recommendedBody: string;
    prompt: string;
    validation: string[];
    placementGuide?: Array<{
      label: string;
      path: string;
      detail: string;
    }>;
    placementRules?: string[];
  }
> = {
  "feature-development": {
    label: "Feature development",
    summary:
      "Shape work across the app, shared UI, API, DB, and deployment flow without rediscovering the repo.",
    recommendedTitle: "Start with a guided plan",
    recommendedBody:
      "Use the template layout and docs/ai artifacts to turn a high-level request into package-scoped work with clear rollout and validation.",
    prompt:
      "Plan the next create-gmacko-app feature end to end. Use the create-gmacko-app-feature-development skill to place code correctly across docs/ai, apps/nextjs, packages/ui, packages/api, packages/db, and local helpers. Include Storybook, Playwright, /browse, and Maestro validation where the feature touches those surfaces.",
    validation: [
      "Confirm the scope against docs/ai before dispatch.",
      "Split work by package boundary instead of by screen only.",
      "Review build, browser QA, and deploy state before closing the task.",
    ],
    placementGuide: [
      {
        label: "App routes and wiring",
        path: "apps/nextjs",
        detail:
          "Use for routes, page composition, app-specific providers, and feature hooks tied to one flow.",
      },
      {
        label: "Shared UI and stories",
        path: "packages/ui",
        detail:
          "Use for reusable components, visual primitives, and Storybook coverage.",
      },
      {
        label: "Backend behavior",
        path: "packages/api",
        detail:
          "Use for procedures, routers, domain services, and integration orchestration.",
      },
      {
        label: "Schema and persistence",
        path: "packages/db",
        detail:
          "Use for schema, migrations, seeds, and DB-specific helpers.",
      },
    ],
    placementRules: [
      "Keep helpers close to the layer they serve until reuse is proven.",
      "Promote code into a package only when multiple consumers or a stable platform concern justify it.",
      "Avoid generic utils buckets that hide ownership.",
    ],
  },
  "ui-ux": {
    label: "UI/UX iteration",
    summary:
      "Push React work through Storybook, state coverage, and shared component stories before implementation drift sets in.",
    recommendedTitle: "Generate Storybook coverage",
    recommendedBody:
      "Drive the feature through meaningful happy paths, loading, error, empty, overflow, responsive, and accessibility variants before polishing code.",
    prompt:
      "Design this create-gmacko-app UI change for React. Generate Storybook stories, realistic and adversarial fixtures, and state coverage across apps/nextjs and packages/ui.",
    validation: [
      "Review visual states before asking for code cleanup.",
      "Check long-text, empty, loading, and error variants.",
      "Verify responsive and accessibility-specific stories.",
    ],
  },
  "integration-delivery": {
    label: "Integration delivery",
    summary:
      "Work with the known ecosystem surface across configuration, deployment, third-party services, and operational touchpoints.",
    recommendedTitle: "Map the integration surface first",
    recommendedBody:
      "Make Bob reason from the integration manifest, deployment conventions, and connected systems before changing runtime behavior.",
    prompt:
      "Implement this create-gmacko-app integration change. Trace the impact across gmacko.integrations.json, apps/nextjs, packages/api, packages/db, deployment hooks, and external services.",
    validation: [
      "Verify env and manifest changes together.",
      "Exercise webhook, integration, and deployment paths.",
      "Check release readiness before merging.",
    ],
  },
  "production-response": {
    label: "Production response",
    summary:
      "Investigate incidents with the repo map already loaded so Bob can move from symptom to fix faster.",
    recommendedTitle: "Run an incident-oriented pass",
    recommendedBody:
      "Start from the user-visible failure, trace through the frontend, API, DB, and integration seams, then land the smallest safe fix with rollback awareness.",
    prompt:
      "Investigate this production issue in a create-gmacko-app repo. Trace it across apps/nextjs, packages/api, packages/db, integrations, and deployment state. Propose the smallest safe fix plus validation and rollback.",
    validation: [
      "Reproduce with the affected package boundary in mind.",
      "Confirm the fix at the source rather than only the symptom.",
      "Verify deployment health and post-release signals.",
    ],
  },
};

function renderWorkflowSignals(capability: CreateGmackoAppCapability): string[] {
  return [
    "create-gmacko-app-workflow",
    "storybook-development",
    ...(capability.hasClaudeGstack ? ["gstack"] : []),
  ];
}

function renderFeatureDevelopmentValidationStack(
  capability: CreateGmackoAppCapability,
): Array<{ label: string; detail: string; path: string }> {
  return [
    ...(capability.hasPlaywright
      ? [
          {
            label: "Playwright",
            path: "apps/nextjs",
            detail:
              "Use for deterministic React end-to-end coverage and route-level regressions before shipping.",
          },
        ]
      : []),
    ...(capability.hasClaudeGstack
      ? [
          {
            label: "/browse",
            path: ".claude/skills/gstack",
            detail:
              "Use gstack browser QA for visual review, Storybook inspection, and real-browser validation while iterating.",
          },
        ]
      : []),
    ...(capability.hasMaestro
      ? [
          {
            label: "Maestro",
            path: "apps/expo/.maestro",
            detail:
              "Use for mobile end-to-end flows when the feature touches Expo screens, onboarding, navigation, or device behavior.",
          },
        ]
      : []),
  ];
}

export function ProjectTemplatePanel({
  linkedRepository,
  capability,
  planningAction,
  initialExperience = "feature-development",
}: ProjectTemplatePanelProps) {
  const repoLabel = linkedRepository?.name ?? "this repository";
  const workflowSignals = renderWorkflowSignals(capability);
  const [activeExperience, setActiveExperience] =
    useState<ExperienceKey>(initialExperience);
  const content = EXPERIENCE_CONTENT[activeExperience];
  const validationStack =
    activeExperience === "feature-development"
      ? renderFeatureDevelopmentValidationStack(capability)
      : [];
  const repositoryHref = linkedRepository?.id
    ? `/repositories/${linkedRepository.id}`
    : null;

  return (
    <section className="rounded-[1.75rem] border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(3,105,86,0.16),rgba(15,23,42,0.96))] p-6 text-foreground">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100">
              create-gmacko-app detected
            </Badge>
            <Badge className="border-border/60 bg-background/50 text-foreground">
              Gmacko app
            </Badge>
            {capability.frontendApps.map((frontendApp) => (
              <Badge
                key={frontendApp}
                className="border-border/60 bg-background/50 text-muted-foreground"
              >
                {frontendApp}
              </Badge>
            ))}
          </div>

          <h2 className="mt-4 font-display text-2xl font-semibold">
            create-gmacko-app command center for {repoLabel}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-200/85">
            Bob can use the known monorepo layout, docs/ai planning loop,
            Storybook-first React workflow, Claude repo skills, and ecosystem
            integration signals to guide feature development, testing,
            validation, deployment handoffs, and production response.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4 text-sm text-slate-200/80">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Detection
          </div>
          <div className="mt-2 font-medium text-foreground">
            {capability.confidence} confidence
          </div>
          <div className="mt-1 text-xs text-slate-300/70">
            {linkedRepository?.remoteProvider
              ? `Mapped from ${linkedRepository.remoteProvider}`
              : "Mapped local repository"}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
          Experience tracks
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {EXPERIENCE_ORDER.map((experience) => {
            const entry = EXPERIENCE_CONTENT[experience];
            const isActive = activeExperience === experience;

            return (
              <button
                key={experience}
                type="button"
                onClick={() => setActiveExperience(experience)}
                className={cn(
                  "rounded-2xl border px-4 py-4 text-left transition",
                  isActive
                    ? "border-emerald-400/35 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.08)]"
                    : "border-white/10 bg-black/10 hover:border-white/20 hover:bg-black/20",
                )}
              >
                <div className="text-sm font-medium text-foreground">
                  {entry.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-200/75">
                  {entry.summary}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.05fr_1.2fr_0.95fr]">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Recommended next move
          </div>
          <div className="mt-3 text-lg font-semibold text-foreground">
            {content.recommendedTitle}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-200/75">
            {content.recommendedBody}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {activeExperience === "feature-development" && planningAction
              ? planningAction
              : null}
            {repositoryHref ? (
              <a
                href={repositoryHref}
                className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-4 py-2 text-sm text-foreground transition hover:border-white/30"
              >
                Open repository
              </a>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Tell Bob
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm leading-6 text-slate-100">
            {content.prompt}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Validation path
          </div>
          <div className="mt-3 space-y-3">
            {content.validation.map((step) => (
              <div
                key={step}
                className="rounded-2xl border border-white/8 bg-background/30 px-3 py-3 text-sm leading-6 text-slate-200/75"
              >
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-6 grid gap-4",
          content.placementGuide && validationStack.length > 0
            ? "xl:grid-cols-[0.9fr_1fr_1fr]"
            : "xl:grid-cols-[1fr_1fr]",
        )}
      >
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Bob workflows
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {workflowSignals.map((signal) => (
              <Badge
                key={signal}
                className="border-border/60 bg-background/60 text-foreground"
              >
                {signal}
              </Badge>
            ))}
          </div>
        </div>
        {validationStack.length > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
              Validation stack
            </div>
            <div className="mt-3 space-y-3">
              {validationStack.map((tool) => (
                <div
                  key={tool.label}
                  className="rounded-2xl border border-white/8 bg-background/30 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">
                      {tool.label}
                    </div>
                    <Badge className="border-border/60 bg-background/60 text-muted-foreground">
                      {tool.path}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-200/75">
                    {tool.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {content.placementGuide ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
              Where code goes
            </div>
            <div className="mt-3 space-y-3">
              {content.placementGuide.map((entry) => (
                <div
                  key={entry.path}
                  className="rounded-2xl border border-white/8 bg-background/30 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">
                      {entry.label}
                    </div>
                    <Badge className="border-border/60 bg-background/60 text-muted-foreground">
                      {entry.path}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-200/75">
                    {entry.detail}
                  </p>
                </div>
              ))}
            </div>
            {content.placementRules ? (
              <div className="mt-4 space-y-2">
                {content.placementRules.map((rule) => (
                  <div
                    key={rule}
                    className="rounded-2xl border border-white/8 bg-slate-950/40 px-3 py-3 text-sm leading-6 text-slate-200/75"
                  >
                    {rule}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
            Repository signals
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {capability.evidence.map((marker) => (
              <Badge
                key={marker}
                className="border-border/60 bg-background/60 text-muted-foreground"
              >
                {marker}
              </Badge>
            ))}
          </div>
        </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4">
        <div className="text-xs uppercase tracking-[0.24em] text-slate-300/60">
          Repository signals
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {capability.evidence.map((marker) => (
            <Badge
              key={marker}
              className="border-border/60 bg-background/60 text-muted-foreground"
            >
              {marker}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
