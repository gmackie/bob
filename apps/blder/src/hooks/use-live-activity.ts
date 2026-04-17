"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface UseLiveActivityOptions {
  /** Fetch recent activities across a workspace (uses activity.listRecent) */
  workspaceId?: string;
  /** Fetch activities for a specific work item (uses activity.listByWorkItem) */
  workItemId?: string;
  /** Maximum number of activities to fetch (default 50) */
  limit?: number;
  /** Polling interval in milliseconds (default 5000) */
  interval?: number;
}

function countNewSince(
  items: readonly { createdAt: Date | string }[],
  since: Date,
): number {
  return items.filter((a) => {
    const ts = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
    return ts > since;
  }).length;
}

/**
 * Polls activity events for a workspace (listRecent) or work item (listByWorkItem).
 *
 * Returns `{ activities, isLoading, newCount, markSeen }` where `newCount` tracks
 * activities that arrived since the consumer last called `markSeen()`.
 */
export function useLiveActivity({
  workspaceId,
  workItemId,
  limit = 50,
  interval = 5_000,
}: UseLiveActivityOptions) {
  const trpc = useTRPC();

  const lastSeenRef = useRef<Date>(new Date());

  const useWorkspace = Boolean(workspaceId);
  const useWorkItem = Boolean(workItemId) && !useWorkspace;

  // Workspace-level query (listRecent)
  const workspaceQuery = useQuery({
    ...trpc.activity.listRecent.queryOptions({ limit }),
    enabled: useWorkspace,
    refetchInterval: useWorkspace ? interval : false,
  });

  // Work-item-level query (listByWorkItem).
  // Note: `listByWorkItem` is declared via a shared procedure factory typed as
  // `(procedure: any) => …` in packages/api, which erases the .query()
  // discriminator and causes tRPC client inference to widen to a mutation
  // procedure shape. The underlying procedure IS a query (see
  // `buildListActivitiesProcedure` in `packages/api/src/router/workItems.ts`),
  // so we widen to `any` at the call site until the factory is retyped.
  const workItemQuery = useQuery({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(trpc.activity.listByWorkItem as any).queryOptions({
      workItemId: workItemId ?? "",
      limit,
    }),
    enabled: useWorkItem,
    refetchInterval: useWorkItem ? interval : false,
  });

  const markSeen = () => {
    lastSeenRef.current = new Date();
  };

  // Reset lastSeen when the target changes
  useEffect(() => {
    lastSeenRef.current = new Date();
  }, [workspaceId, workItemId]);

  const lastSeen = lastSeenRef.current;

  const workspaceActivities = workspaceQuery.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workItemActivities: readonly { createdAt: Date | string }[] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((workItemQuery.data as any) ?? []) as readonly {
      createdAt: Date | string;
    }[];

  return {
    /** Activities from the active query (workspace or work-item scoped). */
    workspaceActivities,
    workItemActivities,
    isLoading: useWorkspace
      ? workspaceQuery.isLoading
      : useWorkItem
        ? workItemQuery.isLoading
        : false,
    newCount: useWorkspace
      ? countNewSince(workspaceActivities, lastSeen)
      : useWorkItem
        ? countNewSince(workItemActivities, lastSeen)
        : 0,
    markSeen,
  };
}
