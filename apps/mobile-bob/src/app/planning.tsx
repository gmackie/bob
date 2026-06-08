import { Redirect, router } from "expo-router";
import { ActivityIndicator } from "react-native";

import { TabletPlanningDashboard } from "~/components/tablet/TabletPlanningDashboard";
import { Screen } from "~/components/ui";
import { getMobilePlanningSessionHref } from "~/features/planning/mobile-actions";
import {
  getMobilePlanningFilterHref,
  getTabletDashboardHref,
  getTabletProjectsHref,
  getTabletSettingsHref,
} from "~/features/tablet/navigation";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { authClient } from "~/utils/auth";

export default function PlanningScreen() {
  const { data: session, isPending } = authClient.useSession();
  const gateway = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <TabletPlanningDashboard
      sessions={gateway.sessions}
      onOpenPlanningSession={(sessionId) => {
        router.push(getMobilePlanningSessionHref(sessionId, selectedWorkspaceId) as never);
      }}
      onOpenSummaryTarget={(target) => {
        if (target.type === "projects-dashboard") {
          router.push(getTabletProjectsHref(selectedWorkspaceId, target.filter) as never);
          return;
        }

        router.push(getMobilePlanningFilterHref(target.filter, selectedWorkspaceId) as never);
      }}
      onOpenNavigationAction={(action) => {
        const href =
          action.key === "projects"
            ? getTabletProjectsHref(selectedWorkspaceId)
            : getTabletDashboardHref("planning", selectedWorkspaceId);
        router.push(href as never);
      }}
      onOpenMode={(mode) =>
        router.push(getTabletDashboardHref(mode, selectedWorkspaceId) as never)
      }
      onOpenSettings={() =>
        router.push(getTabletSettingsHref(selectedWorkspaceId) as never)
      }
    />
  );
}
