"use client";

import Link from "next/link";
import {
  CheckCircledIcon,
  CircleIcon,
  ClockIcon,
  ExternalLinkIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

import { useTRPC } from "~/trpc/react";

interface OnboardingWorkspace {
  id: string;
  name: string;
  slug: string;
  lastHeartbeat?: string | null;
}

interface CustomerOnboardingChecklistProps {
  currentWorkspace: OnboardingWorkspace | null;
  workspaceCount: number;
  projectCount: number;
  onCreateWorkspace?: () => void;
  onImportRepositories?: () => void;
}

type ChecklistStep = {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  actionLabel: string;
  href?: string;
  onAction?: () => void;
  disabled?: boolean;
};

function isNodeOnline(lastHeartbeat: string | null | undefined): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000;
}

function StepAction({ step }: { step: ChecklistStep }) {
  if (step.complete) {
    return (
      <Badge variant="default" className="shrink-0">
        Done
      </Badge>
    );
  }

  if (step.href) {
    return (
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={step.href}>
          {step.actionLabel}
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={step.onAction}
      disabled={step.disabled}
    >
      {step.actionLabel}
    </Button>
  );
}

export function CustomerOnboardingChecklist({
  currentWorkspace,
  workspaceCount,
  projectCount,
  onCreateWorkspace,
  onImportRepositories,
}: CustomerOnboardingChecklistProps) {
  const trpc = useTRPC();

  const { data: connections } = useQuery(
    trpc.gitProviders.listConnections.queryOptions(undefined, {
      staleTime: 30_000,
    }),
  );

  const { data: forgeGraphConnection } = useQuery(
    trpc.settings.getForgeGraphConnection.queryOptions(undefined, {
      staleTime: 30_000,
    }),
  );

  const { data: repositories } = useQuery(
    trpc.repository.list.queryOptions(undefined, {
      staleTime: 30_000,
    }),
  );

  const { data: runs } = useQuery(
    trpc.agentRun.list.queryOptions(
      { workspaceId: currentWorkspace?.id ?? "", limit: 1 },
      {
        enabled: Boolean(currentWorkspace?.id),
        staleTime: 15_000,
        refetchInterval: 15_000,
      },
    ),
  );

  const githubConnected = (connections ?? []).some(
    (connection: any) => connection.provider === "github",
  );
  const workspaceCreated = workspaceCount > 0;
  const repositoryImported = (repositories ?? []).some((repo: any) =>
    currentWorkspace
      ? repo.workspaceId === currentWorkspace.id ||
        repo.planningProjectId ||
        repo.remoteProvider === "github"
      : repo.remoteProvider === "github",
  );
  const forgeGraphConnected = Boolean(forgeGraphConnection);
  const daemonConnected = isNodeOnline(currentWorkspace?.lastHeartbeat);
  const firstTaskRun = (runs ?? []).length > 0;

  const steps: ChecklistStep[] = [
    {
      id: "github",
      title: "Connect GitHub",
      description:
        "Use GitHub auth so Bob can see repositories and link pull requests.",
      complete: githubConnected,
      actionLabel: "Open settings",
      href: "/settings?section=git-providers",
    },
    {
      id: "workspace",
      title: "Create a workspace",
      description:
        "Give the team a workspace that groups projects, nodes, and agent runs.",
      complete: workspaceCreated,
      actionLabel: "Create workspace",
      onAction: onCreateWorkspace,
      disabled: !onCreateWorkspace,
    },
    {
      id: "repositories",
      title: "Import a repository",
      description:
        "Turn a GitHub repository into a Bob project and register it for agents.",
      complete: repositoryImported || projectCount > 0,
      actionLabel: "Import repos",
      onAction: onImportRepositories,
      disabled: !currentWorkspace || !onImportRepositories,
    },
    {
      id: "forgegraph",
      title: "Add ForgeGraph token",
      description:
        "Connect ForgeGraph so builds, deploys, and gates can report back.",
      complete: forgeGraphConnected,
      actionLabel: "Add token",
      href: "/settings?section=git-providers",
    },
    {
      id: "daemon",
      title: "Connect daemon",
      description:
        "Run the Bob daemon on a node so it can claim work for this workspace.",
      complete: daemonConnected,
      actionLabel: "View nodes",
      href: "/nodes",
    },
    {
      id: "first-run",
      title: "Run the first task",
      description:
        "Create or open a work item, start planning, then dispatch the first task.",
      complete: firstTaskRun,
      actionLabel: "Start planning",
      href: "/planning",
    },
  ];

  const completed = steps.filter((step) => step.complete).length;
  const nextStep = steps.find((step) => !step.complete);
  const complete = completed === steps.length;

  return (
    <section className="border-border bg-card rounded-lg border">
      <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
            Customer onboarding
          </p>
          <h2 className="font-display text-foreground mt-1 text-xl font-semibold">
            Setup checklist
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {complete
              ? "This workspace is ready for regular task execution."
              : nextStep
                ? `Next: ${nextStep.title.toLowerCase()}.`
                : "Finish the remaining setup steps."}
          </p>
        </div>
        <div className="min-w-32 text-right">
          <div className="text-foreground font-mono text-2xl font-semibold">
            {completed}/{steps.length}
          </div>
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${(completed / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="divide-border divide-y">
        {steps.map((step) => {
          const active = step.id === nextStep?.id;
          const Icon = step.complete
            ? CheckCircledIcon
            : active
              ? ClockIcon
              : CircleIcon;

          return (
            <div
              key={step.id}
              className={cn(
                "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
                active && "bg-primary/5",
              )}
            >
              <div className="flex min-w-0 gap-3">
                <Icon
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    step.complete
                      ? "text-emerald-600 dark:text-emerald-400"
                      : active
                        ? "text-primary"
                        : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <h3 className="text-foreground text-sm font-semibold">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {step.description}
                  </p>
                </div>
              </div>
              <StepAction step={step} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
