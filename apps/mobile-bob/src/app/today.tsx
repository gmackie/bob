import { Redirect, router, Stack } from "expo-router";

import { getSessionHref } from "~/features/planning/navigation";
import { TodayView } from "~/features/today/TodayView";
import { useDailyPlan } from "~/features/today/use-daily-plan";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { authClient } from "~/utils/auth";

/**
 * Today on the phone: the plan Bob proposed, approval, progress through the
 * day, and the review at the end. The morning and evening pushes land here.
 */
export default function TodayScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { workspace, selectedWorkspaceId } = useSelectedWorkspace();
  const plan = useDailyPlan(workspace?.id);

  if (!isPending && !session) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Today" }} />
      <TodayView
        testID="today"
        view={plan.view}
        isLoading={isPending || plan.isLoading}
        isMutating={plan.isMutating}
        error={plan.mutationError ?? plan.error}
        onRefresh={plan.refetch}
        onGenerate={plan.generate}
        onApprove={() => plan.approve()}
        onClose={plan.close}
        onOpenWorkItem={(href) => router.push(href)}
        onOpenSession={(sessionId) =>
          router.push(getSessionHref(sessionId, selectedWorkspaceId))
        }
        onOpenSessions={() => router.push("/sessions")}
      />
    </>
  );
}
