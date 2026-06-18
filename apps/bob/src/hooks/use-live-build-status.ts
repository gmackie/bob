"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface UseLiveBuildStatusOptions {
  /** The work-item / task ID to track builds for */
  taskId: string;
  /** Whether polling is enabled (default true) */
  enabled?: boolean;
}

/**
 * Polls forgegraph revisions, builds, and deployments at a 5-second interval
 * for a given task, providing live build/deploy status updates.
 */
export function useLiveBuildStatus({
  taskId,
  enabled = true,
}: UseLiveBuildStatusOptions) {
  const trpc = useTRPC();

  const {
    data: revisions,
    isLoading: revisionsLoading,
  } = useQuery({
    ...trpc.forgegraph.listRevisions.queryOptions(
      { taskId, limit: 5 },
    ),
    enabled,
    refetchInterval: 5_000,
  });

  const latestRevisionId = revisions?.[0]?.id ?? null;

  const {
    data: builds,
    isLoading: buildsLoading,
  } = useQuery({
    ...trpc.forgegraph.listBuilds.queryOptions(
      { revisionId: latestRevisionId! },
    ),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  const {
    data: deployments,
    isLoading: deploymentsLoading,
  } = useQuery({
    ...trpc.forgegraph.listDeployments.queryOptions(
      { revisionId: latestRevisionId! },
    ),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  return {
    latestRevision: revisions?.[0] ?? null,
    revisions: revisions ?? [],
    builds: builds ?? [],
    deployments: deployments ?? [],
    isLoading: revisionsLoading || buildsLoading || deploymentsLoading,
  };
}
