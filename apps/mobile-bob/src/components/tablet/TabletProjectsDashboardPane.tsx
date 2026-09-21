import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import type {
  MobileProjectDashboardColumnKey,
  MobileProjectStatusRow,
} from "~/features/planning/project-status";
import { Badge, Card } from "~/components/ui";
import {
  buildMobileProjectStatusRows,
  filterMobileProjectStatusRows,
  getMobileProjectDashboardColumns,
  getMobileProjectQueryRefreshOptions,
  getMobileProjectsDashboardHeaderModel,
  normalizeMobileProjectStatusFilter,
} from "~/features/planning/project-status";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { rpc } from "~/utils/api";

const PROJECT_DASHBOARD_COLUMNS = getMobileProjectDashboardColumns();

export function TabletProjectsDashboardPane({
  onSelectProject,
}: {
  onSelectProject?: (projectId: string) => void;
}) {
  const { workspace } = useSelectedWorkspace();
  const searchParams = useLocalSearchParams<{ filter?: string }>();
  const rawFilterParam: unknown = searchParams.filter;
  const statusFilter = normalizeMobileProjectStatusFilter(
    Array.isArray(rawFilterParam)
      ? (rawFilterParam[0] as string | undefined)
      : (rawFilterParam as string | undefined),
  );
  const projectsQuery = useQuery(
    rpc("project.list").queryOptions(
      { workspaceId: workspace?.id ?? "" },
      {
        enabled: Boolean(workspace?.id),
        ...getMobileProjectQueryRefreshOptions(),
      },
    ),
  );
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const rows = useMemo(
    () =>
      buildMobileProjectStatusRows({
        workspaceName: workspace?.name,
        projects,
      }),
    [projects, workspace?.name],
  );
  const visibleRows = useMemo(
    () => filterMobileProjectStatusRows(rows, statusFilter),
    [rows, statusFilter],
  );
  const header = getMobileProjectsDashboardHeaderModel();

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text className="text-foreground text-3xl font-semibold tracking-tight">
            {header.title}
          </Text>
          {header.subtitle ? (
            <Text className="text-muted mt-1 text-sm" numberOfLines={1}>
              {header.subtitle}
            </Text>
          ) : null}
        </View>
        <Text className="text-foreground text-sm font-semibold">
          {visibleRows.length}
        </Text>
      </View>

      {projectsQuery.isLoading ? (
        <View className="mt-12 items-center justify-center">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : rows.length === 0 ? (
        <Card className="mt-6">
          <Text className="text-muted text-sm">
            No projects are configured yet.
          </Text>
        </Card>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-6 overflow-hidden rounded-lg border"
          style={{ borderColor: colors.border }}
        >
          <View style={{ minWidth: 1_300 }}>
            <View
              className="flex-row px-3 py-2"
              style={{ backgroundColor: colors.secondary }}
            >
              {PROJECT_DASHBOARD_COLUMNS.map((column) => (
                <HeaderCell
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                />
              ))}
            </View>
            {visibleRows.map((row, index) => (
              <ProjectRow
                key={row.id}
                row={row}
                showDivider={index < visibleRows.length - 1}
                onPress={() => onSelectProject?.(row.id)}
              />
            ))}
            {visibleRows.length === 0 ? (
              <Text className="text-muted px-3 py-6 text-sm">
                No projects match this filter.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </ScrollView>
  );
}

function HeaderCell({
  label,
  columnKey,
}: {
  label: string;
  columnKey: MobileProjectDashboardColumnKey;
}) {
  return (
    <Text
      className="text-muted text-xs font-semibold tracking-wider uppercase"
      style={columnStyle(columnKey)}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
}

function ProjectRow({
  row,
  showDivider,
  onPress,
}: {
  row: MobileProjectStatusRow;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open project ${row.title}`}
      className="flex-row items-center gap-3 px-3 py-3 active:opacity-75"
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colors.border,
      }}
    >
      <View className="min-w-0" style={columnStyle("project")}>
        <Text
          className="text-foreground text-sm font-semibold"
          numberOfLines={1}
        >
          {row.title}
        </Text>
        <Text className="text-muted mt-1 text-xs" numberOfLines={1}>
          {row.projectStatus}
        </Text>
      </View>
      <Text
        className="text-muted text-xs"
        style={columnStyle("workspace")}
        numberOfLines={1}
      >
        {row.workspaceName}
      </Text>
      <Text
        className="text-muted text-xs"
        style={columnStyle("directory")}
        numberOfLines={1}
      >
        {row.directory}
      </Text>
      <Text
        className="text-muted text-xs"
        style={columnStyle("repository")}
        numberOfLines={1}
      >
        {row.repository}
      </Text>
      <Text
        className="text-muted text-xs"
        style={columnStyle("branch")}
        numberOfLines={1}
      >
        {row.branchLabel}
      </Text>
      <Text
        className="text-muted text-xs"
        style={columnStyle("build")}
        numberOfLines={1}
      >
        {row.buildSystem}
      </Text>
      <View className="min-w-0" style={columnStyle("git")}>
        <Badge variant={row.gitStatus === "Clean" ? "success" : "warning"}>
          {row.gitStatus}
        </Badge>
      </View>
      <View className="min-w-0" style={columnStyle("linear")}>
        <Badge
          variant={row.linearStatus === "Connected" ? "success" : "warning"}
        >
          {row.linearStatus}
        </Badge>
      </View>
      <View className="min-w-0" style={columnStyle("config")}>
        <Badge
          variant={row.configStatus === "Configured" ? "success" : "warning"}
        >
          {row.configStatus}
        </Badge>
      </View>
      <Text
        className="text-muted text-xs"
        style={columnStyle("warnings")}
        numberOfLines={2}
      >
        {row.warningLabel}
      </Text>
    </Pressable>
  );
}

function columnStyle(key: MobileProjectDashboardColumnKey) {
  const column = PROJECT_DASHBOARD_COLUMNS.find((entry) => entry.key === key);

  return {
    flex: column?.flex ?? 1,
    minWidth: column?.minWidth ?? 100,
  };
}
