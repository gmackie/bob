import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DailyPlanInput, TodayView } from "./today-model";
import { rpc } from "~/utils/api";
import { buildTodayView } from "./today-model";

/**
 * Today's plan for the selected workspace, with the three actions a person
 * can take on it. The query refetches on a slow interval; the gateway's
 * invalidations cover the fast path when work items change.
 */
export function useDailyPlan(workspaceId: string | null | undefined): {
  view: TodayView | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  generate: () => void;
  approve: (workItemIds?: string[]) => void;
  close: () => void;
  isMutating: boolean;
  mutationError: string | null;
} {
  const queryClient = useQueryClient();
  const enabled = Boolean(workspaceId);
  const planQuery = useQuery(
    rpc("planning.dailyPlan.get").queryOptions(
      { workspaceId: workspaceId ?? "" },
      { enabled, refetchInterval: 30_000, retry: 1 },
    ),
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: rpc("planning.dailyPlan.get").queryKey({
        workspaceId: workspaceId ?? "",
      }),
    });
    await queryClient.invalidateQueries({ queryKey: ["workItem"] });
  };

  const generateMutation = useMutation(
    rpc("planning.dailyPlan.generate").mutationOptions({
      onSuccess: invalidate,
    }),
  );
  const approveMutation = useMutation(
    rpc("planning.dailyPlan.approve").mutationOptions({
      onSuccess: invalidate,
    }),
  );
  const closeMutation = useMutation(
    rpc("planning.dailyPlan.close").mutationOptions({ onSuccess: invalidate }),
  );

  const plan = planQuery.data as DailyPlanInput | null | undefined;
  const view = plan ? buildTodayView(plan) : null;
  const mutationError =
    generateMutation.error ??
    approveMutation.error ??
    closeMutation.error ??
    null;

  return {
    view,
    isLoading: planQuery.isLoading,
    error: planQuery.error ? planQuery.error.message : null,
    refetch: () => void planQuery.refetch(),
    generate: () => {
      if (workspaceId) generateMutation.mutate({ workspaceId });
    },
    approve: (workItemIds) => {
      if (plan) approveMutation.mutate({ planId: plan.id, workItemIds });
    },
    close: () => {
      if (plan) closeMutation.mutate({ planId: plan.id });
    },
    isMutating:
      generateMutation.isPending ||
      approveMutation.isPending ||
      closeMutation.isPending,
    mutationError: mutationError ? mutationError.message : null,
  };
}
