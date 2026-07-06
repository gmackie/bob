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

  // The route's workspace always wins in `selectWorkspace` above, so
  // `selectedWorkspaceId` is never load-bearing for *this* render's output —
  // it only matters for *future* renders where `routeWorkspaceId` becomes
  // undefined (e.g. navigating to a route with no `?workspace=` param) and
  // we want the last route-implied workspace to stay the sticky default.
  //
  // Persisting that "adjust state in response to a prop change" is done
  // during render via the classic prev-value-in-state pattern (React's
  // sanctioned escape hatch — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // instead of inside a useEffect body, so it doesn't trigger an extra
  // render pass and doesn't trip react-hooks/set-state-in-effect. (A ref
  // can't be read/written during render, so the "did it change" tracker
  // has to be state, not a ref.)
  const [lastAppliedRouteWorkspaceId, setLastAppliedRouteWorkspaceId] =
    useState<string | undefined>(undefined);
  if (
    routeWorkspaceId &&
    workspace?.id === routeWorkspaceId &&
    lastAppliedRouteWorkspaceId !== routeWorkspaceId
  ) {
    setLastAppliedRouteWorkspaceId(routeWorkspaceId);
    if (selectedWorkspaceId !== routeWorkspaceId) {
      setSelectedWorkspaceId(routeWorkspaceId);
    }
  }

  useEffect(() => {
    if (lastAppliedRouteWorkspaceId !== routeWorkspaceId) return;
    if (!routeWorkspaceId) return;
    void AsyncStorage.setItem(SELECTED_WORKSPACE_KEY, routeWorkspaceId);
  }, [routeWorkspaceId, lastAppliedRouteWorkspaceId]);

  return {
    workspace,
    memberships,
    selectedWorkspaceId: workspace?.id ?? null,
    isLoading: workspacesQuery.isLoading,
  };
}
