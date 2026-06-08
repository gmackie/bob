import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import {
  buildProjectExecutionSummary,
  buildProjectWorkItemRows,
  getMobileProjectDetailQueryRefreshOptions,
} from "~/features/planning/project-detail";
import {
  buildMobileProjectAutomationControls,
  buildMobileProjectConfigurationManagementGroups,
  buildMobileProjectConfigurationSections,
  buildMobileProjectStatusRows,
} from "~/features/planning/project-status";
import type {
  MobileProjectAutomationKey,
  MobileProjectConfigurationManagementGroup,
  MobileProjectConfigurationSection,
  MobileProjectStatusEntry,
  MobileProjectStatusRow,
} from "~/features/planning/project-status";
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
    key: string;
    description: string | null;
    status: string;
    workspaceId: string;
    planningProvider?: string | null;
    linearProjectId?: string | null;
    automationSettings?: Record<string, unknown> | null;
  };
  linkedRepository?: MobileProjectStatusEntry["linkedRepository"];
  counts: {
    active: number;
    issues: number;
    tasks: number;
    epics: number;
  };
}

export default function ProjectDetailScreen() {
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const projectQuery = useQuery(
    trpc.project.get.queryOptions(
      { id: projectId },
      {
        enabled: Boolean(session && projectId),
        ...getMobileProjectDetailQueryRefreshOptions(),
      },
    ),
  );

  const rawWorkItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      {
        workspaceId: (projectQuery.data as ProjectData | undefined)?.project.workspaceId ?? "",
        projectId,
        limit: 50,
      },
      {
        enabled: Boolean((projectQuery.data as ProjectData | undefined)?.project.workspaceId),
        ...getMobileProjectDetailQueryRefreshOptions(),
      },
    ),
  );

  const workItems = useMemo(
    () => (rawWorkItemsQuery.data as WorkItemEntry[] | undefined) ?? [],
    [rawWorkItemsQuery.data],
  );
  const updateAutomationSettings = useMutation(
    trpc.project.updateAutomationSettings.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.project.get.queryKey({ id: projectId }),
        });
      },
    }),
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
  const [configurationRow] = buildMobileProjectStatusRows({
    projects: [projectQuery.data],
  });
  const executionSummary = buildProjectExecutionSummary(
    workItems.map((item) => ({
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      kind: item.kind,
      status: item.status,
    })),
  );
  const workItemRows = buildProjectWorkItemRows({
    items: workItems,
    workspaceId: project.workspaceId,
  });

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

        {configurationRow ? (
          <ProjectConfigurationCard
            row={configurationRow}
            isUpdatingAutomation={updateAutomationSettings.isPending}
            onToggleAutomation={(key, enabled) =>
              updateAutomationSettings.mutate({
                projectId,
                settings: { [key]: enabled },
              })
            }
          />
        ) : null}

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
          {workItemRows.length > 0 ? (
            workItemRows.map((item, index) => (
              <ListRow
                key={item.id}
                title={item.title}
                subtitle={item.subtitle}
                right={<Text className="text-sm text-muted">{item.actionLabel}</Text>}
                onPress={() => router.push(item.href as never)}
                showDivider={index < workItemRows.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm text-muted">No work items in this project.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function ProjectConfigurationCard({
  row,
  isUpdatingAutomation,
  onToggleAutomation,
}: {
  row: MobileProjectStatusRow;
  isUpdatingAutomation: boolean;
  onToggleAutomation: (key: MobileProjectAutomationKey, enabled: boolean) => void;
}) {
  const configurationSections = buildMobileProjectConfigurationSections(row);
  const configurationGroups = buildMobileProjectConfigurationManagementGroups(
    configurationSections,
  );
  const automationControls = buildMobileProjectAutomationControls(row.automationSettings);

  return (
    <Card className="mb-5 gap-3">
      <Text className="text-lg font-semibold text-foreground">
        Configuration
      </Text>

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
        <Text className="text-xs text-muted">{row.warningLabel}</Text>
      </View>

      <View className="border-border border-t pt-3">
        <Text className="text-sm font-semibold uppercase tracking-[0.16em] text-muted2">
          Bob Configuration
        </Text>
        <View className="mt-3 gap-4">
          {configurationGroups.map((group) => (
            <ProjectConfigurationGroup key={group.key} group={group} />
          ))}
        </View>
      </View>

      <View className="border-border border-t pt-3">
        <Text className="text-sm font-semibold uppercase tracking-[0.16em] text-muted2">
          Execution Controls
        </Text>
        <View className="mt-3 gap-2">
          {automationControls.map((control) => (
            <Pressable
              key={control.key}
              onPress={() => onToggleAutomation(control.key, !control.enabled)}
              disabled={isUpdatingAutomation}
              accessibilityRole="switch"
              accessibilityLabel={control.label}
              accessibilityState={{
                checked: control.enabled,
                disabled: isUpdatingAutomation,
              }}
              className="rounded-lg border p-3 active:opacity-75"
              style={{
                borderColor: colors.border,
                backgroundColor: control.enabled
                  ? colors.primary + "20"
                  : colors.background,
                opacity: isUpdatingAutomation ? 0.6 : 1,
              }}
            >
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {control.label}
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-muted">
                    {control.description}
                  </Text>
                </View>
                <Badge variant={control.enabled ? "success" : "warning"}>
                  {control.enabled ? "On" : "Off"}
                </Badge>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </Card>
  );
}

function ProjectConfigurationGroup({
  group,
}: {
  group: MobileProjectConfigurationManagementGroup;
}) {
  if (group.sections.length === 0) return null;

  return (
    <View>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-foreground">
            {group.title}
          </Text>
          <Text className="mt-1 text-xs leading-5 text-muted">
            {group.description}
          </Text>
        </View>
        <View className="flex-row flex-wrap justify-end gap-2">
          {group.actions.map((action) => (
            <View
              key={action.key}
              className="rounded-md border px-2 py-1"
              style={{ borderColor: colors.border, backgroundColor: colors.secondary }}
            >
              <Text className="text-xs font-medium text-muted" numberOfLines={1}>
                {action.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View className="mt-3 gap-2">
        {group.sections.map((section) => (
          <ProjectConfigurationSection key={section.key} section={section} />
        ))}
      </View>
    </View>
  );
}

function ProjectConfigurationSection({
  section,
}: {
  section: MobileProjectConfigurationSection;
}) {
  return (
    <View
      className="rounded-lg border p-3"
      style={{ borderColor: colors.border, backgroundColor: colors.background }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {section.title}
        </Text>
        <Badge
          variant={
            section.status === "ready"
              ? "success"
              : section.status === "warning"
                ? "warning"
                : "danger"
          }
        >
          {section.status}
        </Badge>
      </View>
      <View className="mt-3 gap-2">
        {section.items.map((item) => (
          <MetaLine
            key={`${section.key}-${item.label}`}
            label={item.label}
            value={item.value}
          />
        ))}
      </View>
    </View>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-24 text-xs uppercase text-muted2">{label}</Text>
      <Text className="min-w-0 flex-1 text-xs text-muted" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
