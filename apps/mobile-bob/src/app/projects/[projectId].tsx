import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import {
  buildProjectExecutionSummary,
  getProjectWorkItemAction,
} from "~/features/planning/project-detail";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";

interface WorkItemEntry {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
}

interface ProjectData {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    workspaceId: string;
  };
  counts: {
    active: number;
    issues: number;
    tasks: number;
    epics: number;
  };
}

export default function ProjectDetailScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const projectQuery = useQuery(
    trpc.project.get.queryOptions(
      { id: projectId },
      { enabled: Boolean(session && projectId) },
    ),
  );

  const rawWorkItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      {
        workspaceId: (projectQuery.data as ProjectData | undefined)?.project.workspaceId ?? "",
        projectId,
        limit: 50,
      },
      { enabled: Boolean((projectQuery.data as ProjectData | undefined)?.project.workspaceId) },
    ),
  );

  const workItems = useMemo(
    () => (rawWorkItemsQuery.data as WorkItemEntry[] | undefined) ?? [],
    [rawWorkItemsQuery.data],
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

  if (projectQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!projectQuery.data) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-lg font-semibold text-foreground">
            Project not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const { project, counts } = projectQuery.data as ProjectData;
  const executionSummary = buildProjectExecutionSummary(
    workItems.map((item) => ({
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      kind: item.kind,
      status: item.status,
    })),
  );

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5 flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-sm uppercase tracking-[0.18em] text-muted">
              Project
            </Text>
            <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              {project.name}
            </Text>
            {project.description ? (
              <Text className="mt-3 text-sm leading-6 text-muted">
                {project.description}
              </Text>
            ) : null}
          </View>
          <Badge variant="accent">{project.status.replace(/_/g, " ")}</Badge>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold text-foreground">
            Scope
          </Text>
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                Issues
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {counts.issues}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                Tasks
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {counts.tasks}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                Epics
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {counts.epics}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                Active
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {counts.active}
              </Text>
            </View>
          </View>
        </Card>

        <Card className="mb-5">
          <Text className="text-lg font-semibold text-foreground">
            Execution state
          </Text>
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                In progress
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {executionSummary.inProgress}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                In review
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {executionSummary.inReview}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
                Blocked
              </Text>
              <Text className="mt-1 text-2xl font-semibold text-foreground">
                {executionSummary.blocked}
              </Text>
            </View>
          </View>
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-foreground">Work items</Text>
          <Button variant="ghost" size="sm" onPress={() => router.back()}>
            Back
          </Button>
        </View>

        <Card className="mb-8">
          {workItems.length > 0 ? (
            workItems.map((item, index) => {
              const action = getProjectWorkItemAction({
                id: item.id,
                kind: item.kind,
              });

              return (
                <ListRow
                  key={item.id}
                  title={`${item.identifier} · ${item.title}`}
                  subtitle={`${item.kind} · ${item.status.replace(/_/g, " ")}`}
                  right={<Text className="text-sm text-muted">{action.label}</Text>}
                  onPress={() => router.push(action.href as never)}
                  showDivider={index < workItems.length - 1}
                />
              );
            })
          ) : (
            <Text className="text-sm text-muted">No work items in this project.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
