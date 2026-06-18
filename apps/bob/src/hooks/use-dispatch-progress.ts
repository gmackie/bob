"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/**
 * Monitors dispatch batch progress. Primary updates come via the workspace
 * WebSocket subscription (instant invalidation from useWorkspaceEvents).
 * Polling at 30s serves as a fallback for missed events and ensures
 * dependent tasks get auto-started as predecessors complete.
 *
 * @param batchId - The dispatch batch to monitor, or null to disable.
 * @returns The latest batch data and items, or undefined while loading.
 */
export function useDispatchProgress(batchId: string | null) {
  const trpc = useTRPC();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the batch data — workspace WebSocket pushes instant invalidation,
  // polling is fallback only
  const batchQuery = useQuery(
    trpc.dispatch.getBatch.queryOptions(
      { batchId: batchId! },
      {
        enabled: !!batchId,
        refetchInterval: 30_000,
      },
    ),
  );

  const isActive =
    batchQuery.data?.batch.status === "dispatching" ||
    batchQuery.data?.batch.status === "running";

  // Mutation to trigger server-side progress check + next-wave dispatch
  const checkProgress = useMutation(
    trpc.dispatch.checkProgress.mutationOptions(),
  );

  useEffect(() => {
    if (!batchId || !isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Immediately check once, then every 30s as fallback
    checkProgress.mutate({ batchId });

    intervalRef.current = setInterval(() => {
      checkProgress.mutate({ batchId });
    }, 30_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, isActive]);

  return {
    batch: batchQuery.data?.batch ?? null,
    items: batchQuery.data?.items ?? [],
    isActive,
    isLoading: batchQuery.isLoading,
  };
}
