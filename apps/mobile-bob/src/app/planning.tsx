import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Redirect, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PlanningAttentionItem } from "~/features/planning/navigation";
import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import {
  buildMobilePlanningSessionRequest,
  getMobilePlanningChatHref,
} from "~/features/planning/mobile-actions";
import {
  buildPlanningSections,
  getNotificationsHref,
  getProjectHref,
  getTaskWorkspaceHref,
  getWorkItemHref,
} from "~/features/planning/navigation";
import { getNotificationDestination } from "~/features/planning/notifications";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

interface WorkspaceListEntry {
  workspace: {
    id: string;
    name: string;
  };
}

interface ProjectListEntry {
  project: {
    id: string;
    name: string;
    key: string;
  };
  counts: {
    active: number;
    issues: number;
    tasks: number;
  };
}

interface WorkItemListItem {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
  project?: {
    key: string | null;
  } | null;
}

interface NotificationListItem {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  type: string;
  url: string | null;
  workItemId: string | null;
}

interface NotificationListData {
  items: NotificationListItem[];
}

function isNotificationListData(value: unknown): value is NotificationListData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { items?: unknown };
  return Array.isArray(candidate.items);
}

function formatWorkItemSubtitle(input: {
  kind: string;
  status: string;
  projectKey: string | null;
}) {
  const project = input.projectKey ? `${input.projectKey} · ` : "";
  return `${project}${input.kind} · ${input.status.replace(/_/g, " ")}`;
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: PlanningAttentionItem["tone"];
}) {
  const accentColor =
    tone === "danger"
      ? colors.danger
      : tone === "warning"
        ? colors.warning
        : tone === "accent"
          ? colors.accent
          : colors.foreground;

  return (
    <View className="border-border bg-card min-w-[112px] flex-1 rounded-xl border px-3 py-3">
      <Text className="text-muted2 text-xs uppercase">{label}</Text>
      <Text
        className="mt-1 text-2xl font-semibold"
        style={{ color: accentColor }}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text className="text-foreground text-base font-semibold">{title}</Text>
      {action}
    </View>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <Text className="text-muted text-sm leading-5">{children}</Text>;
}

function PipelineLane({
  title,
  items,
  projectKeyByWorkItemId,
}: {
  title: string;
  items: WorkItemListItem[];
  projectKeyByWorkItemId: Map<string, string | null>;
}) {
  if (items.length === 0) return null;

  return (
    <View>
      <Text className="text-muted2 px-4 pb-1 pt-3 text-xs uppercase">
        {title}
      </Text>
      {items.slice(0, 4).map((item, index) => (
        <ListRow
          key={item.id}
          title={`${item.identifier} · ${item.title}`}
          subtitle={formatWorkItemSubtitle({
            kind: item.kind,
            status: item.status,
            projectKey: projectKeyByWorkItemId.get(item.id) ?? null,
          })}
          right={
            <Text className="text-muted text-sm">
              {item.kind === "task" ? "Workspace" : "Details"}
            </Text>
          }
          onPress={() =>
            router.push(
              (item.kind === "task"
                ? getTaskWorkspaceHref(item.id)
                : getWorkItemHref(item.id)) as never,
            )
          }
          showDivider={index < Math.min(items.length, 4) - 1}
        />
      ))}
    </View>
  );
}

function getCreatedSessionId(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }

  throw new Error("Planning session did not return a session id");
}

export default function PlanningScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const isWide = width >= 720;
  const [planningGoal, setPlanningGoal] = useState("");
  const [planningError, setPlanningError] = useState<string | null>(null);
  const workspacesQuery = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      enabled: Boolean(session),
    }),
  );

  const workspaces = useMemo(
    () => (workspacesQuery.data as WorkspaceListEntry[] | undefined) ?? [],
    [workspacesQuery.data],
  );

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void AsyncStorage.getItem("@bob/selected_workspace")
      .then((id) => {
        if (id) setSelectedWorkspaceId(id);
      })
      .catch(() => {
        setSelectedWorkspaceId(null);
      });
  }, []);

  const primaryWorkspace = useMemo(() => {
    if (selectedWorkspaceId) {
      const found = workspaces.find(
        (w) => w.workspace.id === selectedWorkspaceId,
      );
      if (found) return found.workspace;
    }
    return workspaces[0]?.workspace ?? null;
  }, [workspaces, selectedWorkspaceId]);

  const cycleWorkspace = useCallback(() => {
    if (workspaces.length < 2) return;
    const currentIndex = workspaces.findIndex(
      (w) => w.workspace.id === primaryWorkspace?.id,
    );
    const nextIndex = (currentIndex + 1) % workspaces.length;
    const nextWorkspace = workspaces[nextIndex];
    if (!nextWorkspace) return;
    const nextId = nextWorkspace.workspace.id;
    setSelectedWorkspaceId(nextId);
    void AsyncStorage.setItem("@bob/selected_workspace", nextId);
  }, [workspaces, primaryWorkspace?.id]);

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

  const projects = useMemo(
    () => (projectsQuery.data as ProjectListEntry[] | undefined) ?? [],
    [projectsQuery.data],
  );
  const primaryPlanningProject = projects[0]?.project ?? null;
  const workItems = useMemo(
    () => (workItemsQuery.data as WorkItemListItem[] | undefined) ?? [],
    [workItemsQuery.data],
  );
  const notifications = useMemo(
    () =>
      isNotificationListData(notificationsQuery.data)
        ? notificationsQuery.data.items
        : [],
    [notificationsQuery.data],
  );

  const projectKeyByWorkItemId = useMemo(
    () =>
      new Map(workItems.map((item) => [item.id, item.project?.key ?? null])),
    [workItems],
  );

  const notificationById = useMemo(
    () => new Map(notifications.map((item) => [item.id, item])),
    [notifications],
  );

  const sections = useMemo(
    () =>
      buildPlanningSections({
        workspaces: primaryWorkspace
          ? [
              {
                id: primaryWorkspace.id,
                name: primaryWorkspace.name,
                projectCount: projects.length,
                activeTaskCount: workItems.filter(
                  (item) =>
                    item.kind === "task" &&
                    (item.status === "in_progress" ||
                      item.status === "in_review" ||
                      item.status === "blocked"),
                ).length,
              },
            ]
          : [],
        projects: projects.map((entry) => ({
          id: entry.project.id,
          name: entry.project.name,
          key: entry.project.key,
          activeCount: entry.counts.active,
          issueCount: entry.counts.issues,
          taskCount: entry.counts.tasks,
        })),
        workItems: workItems.map((item) => ({
          id: item.id,
          identifier: item.identifier,
          title: item.title,
          kind: item.kind,
          status: item.status,
        })),
        notifications: notifications.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          read: item.read,
        })),
      }),
    [notifications, primaryWorkspace, projects, workItems],
  );
  const isDashboardLoading =
    projectsQuery.isLoading ||
    workItemsQuery.isLoading ||
    notificationsQuery.isLoading;
  const primaryAction = sections.primaryAction;
  const createPlanningSessionMutation = useMutation(
    trpc.planSession.create.mutationOptions(),
  );
  const startPlanningSessionMutation = useMutation(
    trpc.planSession.start.mutationOptions(),
  );
  const isStartingPlanning =
    createPlanningSessionMutation.isPending ||
    startPlanningSessionMutation.isPending;

  const openDashboardTarget = useCallback(
    (target: {
      id: string;
      source: "notification" | "workItem" | "project";
      href: string;
    }) => {
      if (target.source === "notification") {
        const source = notificationById.get(target.id) ?? null;
        router.push(
          getNotificationDestination({
            url: source?.url ?? null,
            workItemId: source?.workItemId ?? null,
          }) as never,
        );
        return;
      }

      router.push(target.href as never);
    },
    [notificationById],
  );

  const handleStartPlanning = useCallback(async () => {
    const request = buildMobilePlanningSessionRequest({
      workspaceId: primaryWorkspace?.id ?? null,
      projectId: primaryPlanningProject?.id ?? null,
      projectName: primaryPlanningProject?.name ?? null,
      goal: planningGoal,
    });

    if (!request) return;

    setPlanningError(null);
    try {
      const createdSession: unknown =
        await createPlanningSessionMutation.mutateAsync(request.createInput);
      const createdSessionId = getCreatedSessionId(createdSession);
      await startPlanningSessionMutation.mutateAsync(
        request.buildStartInput(createdSessionId),
      );
      setPlanningGoal("");
      await queryClient.invalidateQueries({
        queryKey: trpc.session.list.queryKey({ limit: 50 }),
      });
      router.push(getMobilePlanningChatHref() as never);
    } catch (error) {
      setPlanningError(
        error instanceof Error
          ? error.message
          : "Failed to start planning session",
      );
    }
  }, [
    createPlanningSessionMutation,
    planningGoal,
    primaryPlanningProject?.id,
    primaryPlanningProject?.name,
    primaryWorkspace?.id,
    queryClient,
    startPlanningSessionMutation,
  ]);

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
        <Text className="text-muted mt-3">Loading workspaces…</Text>
      </Screen>
    );
  }

  if (!primaryWorkspace) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-foreground text-xl font-semibold">
            No workspace yet
          </Text>
          <Text className="text-muted mt-2 text-center text-sm">
            Create your first workspace on web, then mobile will pick it up
            here.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen className="pt-4">
      <ScrollView
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="self-center" style={{ maxWidth: 1040, width: "100%" }}>
          <View className="mb-5 flex-row items-start justify-between gap-4">
            <Pressable
              className="min-w-0 flex-1 active:opacity-70"
              onPress={cycleWorkspace}
            >
              <Text className="text-muted text-xs uppercase">
                Workspace
                {workspaces.length > 1
                  ? ` ${workspaces.findIndex((w) => w.workspace.id === primaryWorkspace.id) + 1}/${workspaces.length}`
                  : ""}
              </Text>
              <Text
                className="text-foreground mt-1 text-2xl font-semibold"
                numberOfLines={1}
              >
                {primaryWorkspace.name}
              </Text>
              <Text className="text-muted mt-1 text-sm" numberOfLines={1}>
                {sections.projectTotals.total} projects ·{" "}
                {sections.heroWorkspace?.activeTaskCount ?? 0} active tasks
              </Text>
            </Pressable>

            <View className="items-end gap-2">
              <Pressable
                className="active:opacity-80"
                onPress={() => router.push(getNotificationsHref() as never)}
              >
                <Badge
                  variant={
                    sections.unreadNotifications.length > 0
                      ? "accent"
                      : "default"
                  }
                >
                  {sections.unreadNotifications.length} unread
                </Badge>
              </Pressable>
              {isDashboardLoading ? (
                <Text className="text-muted2 text-xs">Syncing</Text>
              ) : null}
            </View>
          </View>

          <View className={isWide ? "flex-row gap-5" : ""}>
            <View className={isWide ? "min-w-0 flex-[1.25]" : ""}>
              <Card variant="elevated" className="mb-5">
                <Text className="text-muted2 text-xs uppercase">
                  Plan with Bob
                </Text>
                <Text className="text-foreground mt-2 text-lg font-semibold">
                  Start a new planning session
                </Text>
                <Text className="text-muted mt-2 text-sm leading-5">
                  Bob will turn the goal into an actionable plan for{" "}
                  {primaryPlanningProject?.name ?? "this workspace"}.
                </Text>
                <TextInput
                  value={planningGoal}
                  onChangeText={setPlanningGoal}
                  multiline
                  placeholder="What should Bob plan?"
                  placeholderTextColor="#7B8794"
                  className="border-border text-foreground mt-4 min-h-20 rounded-2xl border px-4 py-3"
                />
                <Button
                  className="mt-4"
                  onPress={handleStartPlanning}
                  disabled={
                    !planningGoal.trim() ||
                    !primaryPlanningProject ||
                    isStartingPlanning
                  }
                >
                  {isStartingPlanning ? "Starting..." : "Start planning"}
                </Button>
                {planningError ? (
                  <Text className="text-danger mt-3 text-sm">
                    {planningError}
                  </Text>
                ) : null}
              </Card>

              <Card variant="elevated" className="mb-5">
                {primaryAction ? (
                  <Pressable
                    className="active:opacity-90"
                    onPress={() => openDashboardTarget(primaryAction)}
                  >
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1">
                        <Text className="text-muted2 text-xs uppercase">
                          Next up
                        </Text>
                        <Text
                          className="text-foreground mt-2 text-xl font-semibold"
                          numberOfLines={2}
                        >
                          {primaryAction.title}
                        </Text>
                        {primaryAction.subtitle ? (
                          <Text
                            className="text-muted mt-2 text-sm leading-5"
                            numberOfLines={3}
                          >
                            {primaryAction.subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Badge variant={primaryAction.tone}>
                        {primaryAction.ctaLabel}
                      </Badge>
                    </View>
                  </Pressable>
                ) : (
                  <View>
                    <Text className="text-muted2 text-xs uppercase">
                      Next up
                    </Text>
                    <Text className="text-foreground mt-2 text-xl font-semibold">
                      Workspace is clear
                    </Text>
                    <Text className="text-muted mt-2 text-sm leading-5">
                      New reviews, blockers, and execution updates will appear
                      here.
                    </Text>
                  </View>
                )}
              </Card>

              <View
                className={
                  isWide
                    ? "mb-5 flex-row gap-3"
                    : "mb-5 flex-row flex-wrap gap-3"
                }
              >
                <StatTile
                  label="Blocked"
                  value={sections.executionSummary.blocked}
                  tone="danger"
                />
                <StatTile
                  label="Review"
                  value={sections.executionSummary.inReview}
                  tone="warning"
                />
                <StatTile
                  label="Running"
                  value={sections.executionSummary.inProgress}
                  tone="accent"
                />
                <StatTile
                  label="Projects"
                  value={sections.projectTotals.active}
                />
              </View>

              <View className="mb-5">
                <SectionHeader
                  title="Needs attention"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() =>
                        router.push(getNotificationsHref() as never)
                      }
                    >
                      Inbox
                    </Button>
                  }
                />
                <Card>
                  {sections.attentionItems.length > 0 ? (
                    sections.attentionItems.map((item, index) => (
                      <ListRow
                        key={`${item.source}-${item.id}`}
                        title={item.title}
                        subtitle={item.subtitle ?? undefined}
                        right={<Badge variant={item.tone}>{item.badge}</Badge>}
                        onPress={() => openDashboardTarget(item)}
                        showDivider={index < sections.attentionItems.length - 1}
                      />
                    ))
                  ) : (
                    <EmptyText>
                      No blockers or unread execution updates right now.
                    </EmptyText>
                  )}
                </Card>
              </View>
            </View>

            <View className={isWide ? "min-w-0 flex-1" : ""}>
              <View className="mb-5">
                <SectionHeader title="Work pipeline" />
                <Card>
                  {sections.recentWorkItems.length > 0 ? (
                    <>
                      <PipelineLane
                        title="Running now"
                        items={sections.workPipeline.active}
                        projectKeyByWorkItemId={projectKeyByWorkItemId}
                      />
                      <PipelineLane
                        title="Ready to start"
                        items={sections.workPipeline.queued}
                        projectKeyByWorkItemId={projectKeyByWorkItemId}
                      />
                      <PipelineLane
                        title="Review & blockers"
                        items={sections.workPipeline.review}
                        projectKeyByWorkItemId={projectKeyByWorkItemId}
                      />
                      <PipelineLane
                        title="Done"
                        items={sections.workPipeline.done}
                        projectKeyByWorkItemId={projectKeyByWorkItemId}
                      />
                    </>
                  ) : (
                    <EmptyText>No work items in this workspace yet.</EmptyText>
                  )}
                </Card>
              </View>

              <View className="mb-8">
                <SectionHeader
                  title="Projects"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => router.push("/projects")}
                    >
                      All
                    </Button>
                  }
                />
                <Card>
                  {sections.featuredProjects.length > 0 ? (
                    sections.featuredProjects.map((project, index) => (
                      <ListRow
                        key={project.id}
                        title={`${project.key} · ${project.name}`}
                        subtitle={`${project.taskCount} tasks · ${project.issueCount} issues · ${project.activeCount} active`}
                        right={<Text className="text-muted text-sm">Open</Text>}
                        onPress={() =>
                          router.push(getProjectHref(project.id) as never)
                        }
                        showDivider={
                          index < sections.featuredProjects.length - 1
                        }
                      />
                    ))
                  ) : (
                    <EmptyText>No projects in this workspace yet.</EmptyText>
                  )}
                </Card>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
