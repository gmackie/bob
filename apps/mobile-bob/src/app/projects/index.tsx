import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Card, Screen } from "~/components/ui";
import { getProjectHref } from "~/features/planning/navigation";
import {
  buildMobileProjectStatusRows,
  filterMobileProjectStatusRows,
  getMobileProjectQueryRefreshOptions,
  normalizeMobileProjectStatusFilter,
} from "~/features/planning/project-status";
import type {
  MobileProjectStatusEntry,
  MobileProjectStatusRow,
} from "~/features/planning/project-status";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export default function ProjectsListScreen() {
  const { data: session, isPending } = authClient.useSession();
  const searchParams = useLocalSearchParams<{ filter?: string }>();
  const { workspace, selectedWorkspaceId } = useSelectedWorkspace();

  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: selectedWorkspaceId ?? "" },
      {
        enabled: Boolean(selectedWorkspaceId),
        ...getMobileProjectQueryRefreshOptions(),
      },
    ),
  );

  const projects = useMemo(
    () => (projectsQuery.data as MobileProjectStatusEntry[] | undefined) ?? [],
    [projectsQuery.data],
  );

  const projectRows = useMemo(
    () =>
      buildMobileProjectStatusRows({
        workspaceName: workspace?.name,
        projects,
      }),
    [projects, workspace?.name],
  );
  const rawFilterParam: unknown = searchParams.filter;
  const statusFilter = normalizeMobileProjectStatusFilter(
    Array.isArray(rawFilterParam)
      ? (rawFilterParam[0] as string | undefined)
      : (rawFilterParam as string | undefined),
  );
  const visibleProjectRows = useMemo(
    () => filterMobileProjectStatusRows(projectRows, statusFilter),
    [projectRows, statusFilter],
  );

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

  if (projectsQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
        <Text className="mt-3 text-muted">Loading projects…</Text>
      </Screen>
    );
  }

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <View className="mb-5 flex-row items-center justify-between">
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            Projects
          </Text>
          <Button variant="ghost" size="sm" onPress={() => router.back()}>
            Back
          </Button>
        </View>

        <View className="mb-8 gap-3">
          {visibleProjectRows.length > 0 ? (
            visibleProjectRows.map((row) => (
              <ProjectStatusCard
                key={row.id}
                row={row}
                onPress={() => router.push(getProjectHref(row.id, row.workspaceId) as never)}
              />
            ))
          ) : (
            <Card>
              <Text className="text-sm text-muted">
                {projectRows.length > 0 ? "No projects match this filter." : "No projects yet."}
              </Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ProjectStatusCard({
  row,
  onPress,
}: {
  row: MobileProjectStatusRow;
  onPress: () => void;
}) {
  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
            {row.title}
          </Text>
          <Text className="mt-1 text-xs text-muted">{row.workspaceName}</Text>
        </View>
        <Button variant="ghost" size="sm" onPress={onPress}>
          Open
        </Button>
      </View>

      <View className="gap-1">
        <MetaLine label="Directory" value={row.directory} />
        <MetaLine label="Repository" value={row.repository} />
        <MetaLine label="Branch" value={row.branchLabel} />
        <MetaLine label="Build" value={row.buildSystem} />
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Badge variant={row.gitStatus === "Clean" ? "success" : "warning"}>
          {row.gitStatus}
        </Badge>
        <Badge variant={row.linearStatus === "Connected" ? "success" : "warning"}>
          {row.linearStatus}
        </Badge>
        <Badge variant={row.configStatus === "Configured" ? "success" : "warning"}>
          {row.configStatus}
        </Badge>
      </View>

      <View className="border-border border-t pt-3">
        <Text className="text-sm text-muted">{row.activityLabel}</Text>
        <Text className="mt-1 text-xs text-muted">{row.warningLabel}</Text>
      </View>
    </Card>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-20 text-xs uppercase text-muted2">{label}</Text>
      <Text className="min-w-0 flex-1 text-xs text-muted" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
