import { View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { getSessionHref } from "~/features/planning/navigation";
import { RunRecordView } from "~/features/runs/RunRecordView";
import { getMobileTasksDashboardHref } from "~/features/tablet/navigation";
import { getMobileOutcomeWorkItemHref } from "~/features/tablet/work-item-entry";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";

/**
 * A run record on the phone. Work-item run rows linked here for runs without
 * a session, but the route did not exist, so the row read "Recorded" and
 * refused the tap.
 */
export default function RunScreen() {
  const params = useLocalSearchParams<{ runId: string }>();
  const rawRunId: unknown = params.runId;
  const runId = Array.isArray(rawRunId)
    ? (rawRunId[0] as string | undefined)
    : (rawRunId as string | undefined);
  const { selectedWorkspaceId } = useSelectedWorkspace();

  if (!runId) {
    return <Redirect href={getMobileTasksDashboardHref(selectedWorkspaceId)} />;
  }

  return (
    <View className="bg-background flex-1">
      <Stack.Screen options={{ title: "Run" }} />
      <RunRecordView
        runId={runId}
        onOpenSession={(sessionId) =>
          router.push(getSessionHref(sessionId, selectedWorkspaceId))
        }
        onOpenWorkItem={(workItemId) =>
          router.push(
            getMobileOutcomeWorkItemHref(workItemId, selectedWorkspaceId),
          )
        }
      />
    </View>
  );
}
