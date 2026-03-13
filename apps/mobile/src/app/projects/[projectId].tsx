import { Redirect, router, useLocalSearchParams } from "expo-router";
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

  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      {
        workspaceId: projectQuery.data?.project.workspaceId ?? "",
        projectId,
        limit: 50,
      },
      { enabled: Boolean(projectQuery.data?.project.workspaceId) },
    ),
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
          <Text className="text-foreground text-lg font-semibold">
            Project not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const { project, counts } = projectQuery.data;
  const executionSummary = buildProjectExecutionSummary(
    (workItemsQuery.data ?? []).map((item) => ({
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
            <Text className="text-muted text-sm uppercase tracking-[0.18em]">
              Project
            </Text>
            <Text className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
              {project.name}
            </Text>
            {project.description ? (
              <Text className="text-muted mt-3 text-sm leading-6">
                {project.description}
              </Text>
            ) : null}
          </View>
          <Badge variant="accent">{project.status.replace(/_/g, " ")}</Badge>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-foreground text-lg font-semibold">
            Scope
          </Text>
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                Issues
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {counts.issues}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                Tasks
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {counts.tasks}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                Epics
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {counts.epics}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                Active
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {counts.active}
              </Text>
            </View>
          </View>
        </Card>

        <Card className="mb-5">
          <Text className="text-foreground text-lg font-semibold">
            Execution state
          </Text>
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                In progress
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {executionSummary.inProgress}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                In review
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {executionSummary.inReview}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-muted2 text-xs uppercase tracking-[0.16em]">
                Blocked
              </Text>
              <Text className="text-foreground mt-1 text-2xl font-semibold">
                {executionSummary.blocked}
              </Text>
            </View>
          </View>
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">Work items</Text>
          <Button variant="ghost" size="sm" onPress={() => router.back()}>
            Back
          </Button>
        </View>

        <Card className="mb-8">
          {workItemsQuery.data?.length ? (
            workItemsQuery.data.map((item, index) => {
              const action = getProjectWorkItemAction({
                id: item.id,
                kind: item.kind,
              });

              return (
                <ListRow
                  key={item.id}
                  title={`${item.identifier} · ${item.title}`}
                  subtitle={`${item.kind} · ${item.status.replace(/_/g, " ")}`}
                  right={<Text className="text-muted text-sm">{action.label}</Text>}
                  onPress={() => router.push(action.href as never)}
                  showDivider={index < workItemsQuery.data.length - 1}
                />
              );
            })
          ) : (
            <Text className="text-muted text-sm">No work items in this project.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
