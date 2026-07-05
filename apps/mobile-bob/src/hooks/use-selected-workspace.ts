import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  SELECTED_WORKSPACE_KEY,
  selectWorkspace,
} from "~/features/settings/workspace-selection";
import type { SelectableWorkspaceMembership } from "~/features/settings/workspace-selection";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export function useSelectedWorkspace() {
  const { data: session } = authClient.useSession();
  const params = useLocalSearchParams<{ workspace?: string }>();
  const rawWorkspaceParam: unknown = params.workspace;
  const routeWorkspaceId: string | undefined = Array.isArray(rawWorkspaceParam)
    ? (rawWorkspaceParam[0] as string | undefined)
    : (rawWorkspaceParam as string | undefined);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const workspacesQuery = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      enabled: Boolean(session),
      staleTime: 60_000,
    }),
  );

  useEffect(() => {
    void AsyncStorage.getItem(SELECTED_WORKSPACE_KEY)
      .then(setSelectedWorkspaceId)
      .catch(() => setSelectedWorkspaceId(null));
  }, []);

  const memberships = useMemo(
    () =>
      (Array.isArray(workspacesQuery.data)
        ? workspacesQuery.data
        : []) as SelectableWorkspaceMembership[],
    [workspacesQuery.data],
  );

  const workspace = useMemo(
    () => selectWorkspace({ selectedWorkspaceId, routeWorkspaceId, memberships }),
    [memberships, routeWorkspaceId, selectedWorkspaceId],
  );

  useEffect(() => {
    if (!routeWorkspaceId || workspace?.id !== routeWorkspaceId) return;
    setSelectedWorkspaceId(routeWorkspaceId);
    void AsyncStorage.setItem(SELECTED_WORKSPACE_KEY, routeWorkspaceId);
  }, [routeWorkspaceId, workspace?.id]);

  return {
    workspace,
    memberships,
    selectedWorkspaceId: workspace?.id ?? null,
    isLoading: workspacesQuery.isLoading,
  };
}
