import { getPlanningHref } from "~/features/planning/navigation";

export function getTabletDashboardHref(): string {
  return getPlanningHref();
}

export function getTabletDashboardSelectionReset(): {
  selectedSessionId: null;
  selectedWorkItemId: null;
} {
  return {
    selectedSessionId: null,
    selectedWorkItemId: null,
  };
}
