export const TABLET_RAIL_WORK_ITEM_REFETCH_INTERVAL_MS = 10_000;
export const TABLET_RAIL_PROJECT_REFETCH_INTERVAL_MS = 15_000;

export interface TabletRailQueryOptions {
  enabled: boolean;
  refetchInterval: number | false;
}

export function getTabletRailWorkItemQueryOptions(enabled: boolean): TabletRailQueryOptions {
  return {
    enabled,
    refetchInterval: enabled ? TABLET_RAIL_WORK_ITEM_REFETCH_INTERVAL_MS : false,
  };
}

export function getTabletRailProjectQueryOptions(enabled: boolean): TabletRailQueryOptions {
  return {
    enabled,
    refetchInterval: enabled ? TABLET_RAIL_PROJECT_REFETCH_INTERVAL_MS : false,
  };
}
