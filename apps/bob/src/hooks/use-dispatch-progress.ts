"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/**
 * Polls `dispatch.checkProgress` every 10 seconds while a batch is actively
 * dispatching or running. This ensures dependent tasks get auto-started as
 * predecessors complete.
 *
 * @param batchId - The dispatch batch to monitor, or null to disable.
 * @returns The latest batch data and items, or undefined while loading.
 */
export function useDispatchProgress(batchId: string | null) {
  const trpc = useTRPC();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the batch data (polls every 10s so we always have fresh status)
  const batchQuery = useQuery(
    trpc.dispatch.getBatch.queryOptions(
      { batchId: batchId! },
      {
        enabled: !!batchId,
        refetchInterval: 10_000,
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

    // Immediately check once, then every 10s
    checkProgress.mutate({ batchId });

    intervalRef.current = setInterval(() => {
      checkProgress.mutate({ batchId });
    }, 10_000);

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
