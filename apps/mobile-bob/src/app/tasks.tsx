import { Redirect, router, useLocalSearchParams } from "expo-router";

import { TasksDashboard } from "~/components/tablet/TasksDashboard";
import { TaskLaneTablePane } from "~/components/tablet/TaskLaneTablePane";
import type { TaskLaneKey } from "~/features/tablet/dashboard";
import {
  getMobileTaskTabHref,
  getTabletDashboardHref,
  getTabletProviderHref,
  getTabletSettingsHref,
  getTabletTaskLaneHref,
  getTabletTaskLaneWorkItemHref,
} from "~/features/tablet/navigation";
import {
  getMobileOutcomeWorkItemHref,
  getMobileQueueWorkItemHref,
  type MobileWorkItemEntryView,
} from "~/features/tablet/work-item-entry";
import { getLiveDashboardSessions } from "~/hooks/gateway-sessions";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { authClient } from "~/utils/auth";

const TASK_LANE_KEYS = new Set(["needs-attention", "ready", "active", "review"]);

function parseLane(value: string | string[] | undefined): TaskLaneKey | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && TASK_LANE_KEYS.has(raw) ? (raw as TaskLaneKey) : null;
}

export default function TasksScreen() {
  const { data: session, isPending } = authClient.useSession();
  const gateway = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const params = useLocalSearchParams<{ lane?: string }>();
  const lane = parseLane(params.lane);

  if (isPending) {
    return <TasksDashboard sessions={[]} />;
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  if (lane) {
    return (
      <TaskLaneTablePane
        lane={lane}
        onOpenWorkItem={(workItemId, view = "queue") =>
          router.push(
            getTabletTaskLaneWorkItemHref(
              { workItemId, view },
              selectedWorkspaceId,
            ) as never,
          )
        }
      />
    );
  }

  const handleOpenWorkItem = (
    workItemId: string,
    view: MobileWorkItemEntryView = "queue",
  ) => {
    const href =
      view === "outcome"
        ? getMobileOutcomeWorkItemHref(workItemId, selectedWorkspaceId)
        : getMobileQueueWorkItemHref(workItemId, selectedWorkspaceId);
    router.push(href as never);
  };

  return (
    <TasksDashboard
      sessions={getLiveDashboardSessions(gateway.sessions)}
      onOpenProvider={(provider) =>
        router.push(getTabletProviderHref(provider, selectedWorkspaceId) as never)
      }
      onOpenLane={(targetLane) =>
        router.push(getTabletTaskLaneHref(targetLane, selectedWorkspaceId) as never)
      }
      onOpenWorkItem={handleOpenWorkItem}
      onOpenTaskTab={(tab) =>
        router.push(getMobileTaskTabHref(tab, selectedWorkspaceId) as never)
      }
      onOpenMode={(mode) =>
        router.push(getTabletDashboardHref(mode, selectedWorkspaceId) as never)
      }
      onOpenSettings={() =>
        router.push(getTabletSettingsHref(selectedWorkspaceId) as never)
      }
    />
  );
}
