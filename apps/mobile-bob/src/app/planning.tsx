import { Redirect, router } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import {
  buildPlanningSections,
  getNotificationsHref,
  getProjectHref,
  getTaskWorkspaceHref,
  getWorkItemHref,
} from "~/features/planning/navigation";
import {
  getNotificationDestination,
  getNotificationPreviewSubtitle,
} from "~/features/planning/notifications";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";

function formatWorkItemSubtitle(input: {
  kind: string;
  status: string;
  projectKey: string | null;
}) {
  const project = input.projectKey ? `${input.projectKey} · ` : "";
  return `${project}${input.kind} · ${input.status.replace(/_/g, " ")}`;
}

export default function PlanningScreen() {
  const { data: session, isPending } = authClient.useSession();
  const workspacesQuery = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      enabled: Boolean(session),
    }),
  );

  const primaryWorkspace = workspacesQuery.data?.[0]?.workspace ?? null;

  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "" },
      { enabled: Boolean(primaryWorkspace?.id) },
    ),
  );

  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "", limit: 12 },
      { enabled: Boolean(primaryWorkspace?.id) },
    ),
  );

  const notificationsQuery = useQuery(
    trpc.notification.list.queryOptions(
      { limit: 12 },
      { enabled: Boolean(session) },
    ),
  );

  const projectKeyByWorkItemId = useMemo(
    () =>
      new Map(
        (workItemsQuery.data ?? []).map((item) => [item.id, item.project?.key ?? null]),
      ),
    [workItemsQuery.data],
  );

  const notificationById = useMemo(
    () => new Map((notificationsQuery.data?.items ?? []).map((item) => [item.id, item])),
    [notificationsQuery.data?.items],
  );

  const sections = useMemo(
    () =>
      buildPlanningSections({
        workspaces: primaryWorkspace
          ? [
              {
                id: primaryWorkspace.id,
                name: primaryWorkspace.name,
                projectCount: projectsQuery.data?.length ?? 0,
                activeTaskCount:
                  workItemsQuery.data?.filter(
                    (item) =>
                      item.kind === "task" &&
                      (item.status === "in_progress" ||
                        item.status === "in_review" ||
                        item.status === "blocked"),
                  ).length ?? 0,
              },
            ]
          : [],
        projects:
          projectsQuery.data?.map((entry) => ({
            id: entry.project.id,
            name: entry.project.name,
            key: entry.project.key,
            activeCount: entry.counts.active,
            issueCount: entry.counts.issues,
            taskCount: entry.counts.tasks,
          })) ?? [],
        workItems:
          workItemsQuery.data?.map((item) => ({
            id: item.id,
            identifier: item.identifier,
            title: item.title,
            kind: item.kind,
            status: item.status,
          })) ?? [],
        notifications:
          notificationsQuery.data?.items.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            read: item.read,
          })) ?? [],
      }),
    [
      notificationsQuery.data?.items,
      primaryWorkspace,
      projectsQuery.data,
      workItemsQuery.data,
    ],
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

  if (workspacesQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
        <Text className="mt-3" style={{ color: colors.muted }}>Loading workspaces…</Text>
      </Screen>
    );
  }

  if (!primaryWorkspace) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-xl font-semibold" style={{ color: colors.foreground }}>
            No workspace yet
          </Text>
          <Text className="mt-2 text-center text-sm" style={{ color: colors.muted }}>
            Create your first workspace on web, then mobile will pick it up here.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <View className="mb-6 flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-sm uppercase tracking-[0.18em]" style={{ color: colors.muted }}>
              Workspace
            </Text>
            <Text className="mt-1 text-3xl font-semibold tracking-tight" style={{ color: colors.foreground }}>
              {primaryWorkspace.name}
            </Text>
          </View>
          <Pressable
            className="active:opacity-80"
            onPress={() => router.push(getNotificationsHref() as never)}
          >
            <Badge variant="accent">
              {sections.unreadNotifications.length} unread
            </Badge>
          </Pressable>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
            Execution snapshot
          </Text>
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em]" style={{ color: colors.muted2 }}>
                In progress
              </Text>
              <Text className="mt-1 text-2xl font-semibold" style={{ color: colors.foreground }}>
                {sections.executionSummary.inProgress}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em]" style={{ color: colors.muted2 }}>
                In review
              </Text>
              <Text className="mt-1 text-2xl font-semibold" style={{ color: colors.foreground }}>
                {sections.executionSummary.inReview}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs uppercase tracking-[0.16em]" style={{ color: colors.muted2 }}>
                Blocked
              </Text>
              <Text className="mt-1 text-2xl font-semibold" style={{ color: colors.foreground }}>
                {sections.executionSummary.blocked}
              </Text>
            </View>
          </View>
          <Text className="mt-4 text-sm" style={{ color: colors.muted }}>
            {sections.heroWorkspace?.projectCount ?? 0} projects,{" "}
            {sections.heroWorkspace?.activeTaskCount ?? 0} active task runs
          </Text>
        </Card>

        <View className="mb-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Projects</Text>
            {sections.featuredProjects[0] ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() =>
                  router.push(getProjectHref(sections.featuredProjects[0]!.id) as never)
                }
              >
                Open latest
              </Button>
            ) : null}
          </View>
          <Card>
            {sections.featuredProjects.length > 0 ? (
              sections.featuredProjects.map((project, index) => (
                <ListRow
                  key={project.id}
                  title={`${project.key} · ${project.name}`}
                  subtitle={`${project.taskCount} tasks · ${project.issueCount} issues · ${project.activeCount} active`}
                  right={<Text className="text-sm" style={{ color: colors.muted }}>Open</Text>}
                  onPress={() => router.push(getProjectHref(project.id) as never)}
                  showDivider={index < sections.featuredProjects.length - 1}
                />
              ))
            ) : (
              <Text className="text-sm" style={{ color: colors.muted }}>No projects yet.</Text>
            )}
          </Card>
        </View>

        <View className="mb-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
              Recent work items
            </Text>
          </View>
          <Card>
            {sections.recentWorkItems.length > 0 ? (
              sections.recentWorkItems.map((item, index) => (
                <ListRow
                  key={item.id}
                  title={`${item.identifier} · ${item.title}`}
                  subtitle={formatWorkItemSubtitle({
                    kind: item.kind,
                    status: item.status,
                    projectKey: projectKeyByWorkItemId.get(item.id) ?? null,
                  })}
                  right={
                    item.kind === "task" ? (
                      <Text className="text-sm" style={{ color: colors.muted }}>Workspace</Text>
                    ) : (
                      <Text className="text-sm" style={{ color: colors.muted }}>Details</Text>
                    )
                  }
                  onPress={() =>
                    router.push(
                      (item.kind === "task"
                        ? getTaskWorkspaceHref(item.id)
                        : getWorkItemHref(item.id)) as never,
                    )
                  }
                  showDivider={index < sections.recentWorkItems.length - 1}
                />
              ))
            ) : (
              <Text className="text-sm" style={{ color: colors.muted }}>No work items yet.</Text>
            )}
          </Card>
        </View>

        <View className="mb-8">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Inbox</Text>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => router.push(getNotificationsHref() as never)}
            >
              Open inbox
            </Button>
          </View>
          <Card>
            {sections.unreadNotifications.length > 0 ? (
              sections.unreadNotifications.map((item, index) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  subtitle={getNotificationPreviewSubtitle({
                    body: item.body,
                    type: notificationById.get(item.id)?.type ?? "notification",
                  })}
                  onPress={() => {
                    const source = notificationById.get(item.id) ?? null;

                    router.push(
                      getNotificationDestination({
                        url: source?.url ?? null,
                        workItemId: source?.workItemId ?? null,
                      }) as never,
                    );
                  }}
                  showDivider={index < sections.unreadNotifications.length - 1}
                />
              ))
            ) : (
              <Text className="text-sm" style={{ color: colors.muted }}>
                No unread notifications. Execution milestones will land here.
              </Text>
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
