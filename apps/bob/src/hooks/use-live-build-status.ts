"use client";

import { useQuery } from "@tanstack/react-query";

import { useBobRpcClient } from "~/rpc/react";

interface UseLiveBuildStatusOptions {
  /** The work-item / task ID to track builds for */
  taskId: string;
  /** Whether polling is enabled (default true) */
  enabled?: boolean;
}

type RevisionRow = {
  id: string;
  revId: string;
  branch?: string | null;
  gates?: unknown[];
};

/**
 * Polls forgegraph revisions, builds, and deployments at a 5-second interval
 * for a given task, providing live build/deploy status updates.
 */
export function useLiveBuildStatus({
  taskId,
  enabled = true,
}: UseLiveBuildStatusOptions) {
  const rpc = useBobRpcClient();
  const revisionsInput = { taskId, limit: 5 };

  const {
    data: revisions,
    isLoading: revisionsLoading,
  } = useQuery({
    queryKey: ["rpc", "external.forgegraph.listRevisions", revisionsInput],
    queryFn: () => rpc.external.forgegraph.listRevisions(revisionsInput),
    enabled,
    refetchInterval: 5_000,
  });

  const revisionRows = (revisions ?? []) as RevisionRow[];
  const latestRevisionId = revisionRows[0]?.id ?? null;
  const buildsInput = { revisionId: latestRevisionId ?? "" };

  const {
    data: builds,
    isLoading: buildsLoading,
  } = useQuery({
    queryKey: ["rpc", "external.forgegraph.listBuilds", buildsInput],
    queryFn: () => rpc.external.forgegraph.listBuilds(buildsInput),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  const deploymentsInput = { revisionId: latestRevisionId ?? "" };

  const {
    data: deployments,
    isLoading: deploymentsLoading,
  } = useQuery({
    queryKey: ["rpc", "external.forgegraph.listDeployments", deploymentsInput],
    queryFn: () => rpc.external.forgegraph.listDeployments(deploymentsInput),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  return {
    latestRevision: revisionRows[0] ?? null,
    revisions: revisionRows,
    builds: builds ?? [],
    deployments: deployments ?? [],
    isLoading: revisionsLoading || buildsLoading || deploymentsLoading,
  };
}
