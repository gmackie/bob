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

function countNewSince<T extends { createdAt: Date | string }>(
  items: T[],
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

  // Work-item-level query (listByWorkItem)
  const workItemQuery = useQuery({
    ...trpc.activity.listByWorkItem.queryOptions({
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
  const workItemActivities = workItemQuery.data ?? [];

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
