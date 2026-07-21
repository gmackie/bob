import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Card } from "~/components/ui";
import {
  buildProjectExecutionSummary,
  buildProjectWorkItemRows,
  getMobileProjectDetailQueryRefreshOptions,
  getProjectWorkItemAction,
} from "~/features/planning/project-detail";
import {
  buildMobileProjectAutomationControls,
  buildMobileProjectConfigurationManagementGroups,
  buildMobileProjectConfigurationSections,
  buildMobileProjectStatusRows





} from "~/features/planning/project-status";
import type {MobileProjectAutomationKey, MobileProjectConfigurationManagementGroup, MobileProjectConfigurationSection, MobileProjectStatusEntry, MobileProjectStatusRow} from "~/features/planning/project-status";
import type { MobileWorkItemEntryView } from "~/features/tablet/work-item-entry";
import { formatStatusLabel } from "~/features/tablet/queue";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

interface ProjectWorkItem {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
}

interface ProjectData extends MobileProjectStatusEntry {
  project: MobileProjectStatusEntry["project"] & {
    description?: string | null;
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

export function TabletProjectPane({
  projectId,
  onOpenWorkItem,
}: {
  projectId: string;
  onOpenWorkItem?: (workItemId: string, view?: MobileWorkItemEntryView) => void;
}) {
  const queryClient = useQueryClient();
  const projectQuery = useQuery(
    trpc.project.get.queryOptions(
      { id: projectId },
      {
        enabled: Boolean(projectId),
        ...getMobileProjectDetailQueryRefreshOptions(),
      },
    ),
  );
  const projectData = projectQuery.data as ProjectData | undefined;
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      {
        workspaceId: projectData?.project.workspaceId ?? "",
        projectId,
        limit: 80,
      },
      {
        enabled: Boolean(projectData?.project.workspaceId),
        ...getMobileProjectDetailQueryRefreshOptions(),
      },
    ),
  );
  const workItems = useMemo(
    () => (workItemsQuery.data as ProjectWorkItem[] | undefined) ?? [],
    [workItemsQuery.data],
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

  if (projectQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (!projectData) {
    return (
      <View className="flex-1 justify-center p-6">
        <Card>
          <Text className="text-lg font-semibold text-foreground">Project not found</Text>
        </Card>
      </View>
    );
  }

  const { project, counts } = projectData;
  const [configurationRow] = buildMobileProjectStatusRows({
    projects: [projectData],
  });
  const executionSummary = buildProjectExecutionSummary(workItems);
  const workItemRows = buildProjectWorkItemRows({
    items: workItems,
    workspaceId: project.workspaceId,
  });

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text className="text-sm uppercase tracking-[0.18em] text-muted">
            Project
          </Text>
          <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {project.name}
          </Text>
          {project.description ? (
            <Text className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              {project.description}
            </Text>
          ) : null}
        </View>
        <Badge variant="accent">{project.status.replace(/_/g, " ")}</Badge>
      </View>

      <View className="mt-6 flex-row gap-3">
        <Metric label="Issues" value={counts.issues} />
        <Metric label="Tasks" value={counts.tasks} />
        <Metric label="Epics" value={counts.epics} />
        <Metric label="Active" value={counts.active} />
      </View>

      {configurationRow ? (
        <ProjectConfigurationPanel
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

      <View className="mt-5 flex-row gap-3">
        <Metric label="In Progress" value={executionSummary.inProgress} />
        <Metric label="In Review" value={executionSummary.inReview} />
        <Metric label="Blocked" value={executionSummary.blocked} />
      </View>

      <View className="mt-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
            Work Items
          </Text>
          <Text className="text-xs text-muted">{workItems.length}</Text>
        </View>
        <View
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: colors.border }}
        >
          {workItemsQuery.isLoading ? (
            <View className="items-center justify-center p-6">
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : workItems.length === 0 ? (
            <Text className="p-4 text-sm text-muted">
              No work items in this project.
            </Text>
          ) : (
            workItems.map((item, index) => (
              <ProjectWorkItemRow
                key={item.id}
                item={item}
                row={workItemRows[index]}
                showDivider={index < workItems.length - 1}
                onPress={() => {
                  const view: MobileWorkItemEntryView =
                    item.kind === "task" ? "queue" : "planning";
                  onOpenWorkItem?.(item.id, view);
                }}
              />
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View
      className="flex-1 rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted2">
        {label}
      </Text>
      <Text className="mt-2 text-2xl font-semibold text-foreground">
        {value}
      </Text>
    </View>
  );
}

function ProjectConfigurationPanel({
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
    <View
      className="mt-5 rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
        Configuration
      </Text>
      <View className="mt-4 gap-2">
        <MetaLine label="Directory" value={row.directory} />
        <MetaLine label="Repository" value={row.repository} />
        <MetaLine label="Branch" value={row.branchLabel} />
        <MetaLine label="Build" value={row.buildSystem} />
      </View>
      <View className="mt-4 flex-row flex-wrap gap-2">
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
      <Text className="mt-4 text-xs text-muted">{row.warningLabel}</Text>

      <View className="mt-5 border-t pt-4" style={{ borderColor: colors.border }}>
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Bob Configuration
        </Text>
        <View className="mt-3 gap-4">
          {configurationGroups.map((group) => (
            <ConfigurationManagementGroup key={group.key} group={group} />
          ))}
        </View>
      </View>

      <View className="mt-5 border-t pt-4" style={{ borderColor: colors.border }}>
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Execution Controls
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-3">
          {automationControls.map((control) => (
            <Pressable
              key={control.key}
              onPress={() => onToggleAutomation(control.key, !control.enabled)}
              disabled={isUpdatingAutomation}
              accessibilityRole="switch"
              accessibilityLabel={control.label}
              accessibilityState={{ checked: control.enabled, disabled: isUpdatingAutomation }}
              className="rounded-lg border p-3 active:opacity-75"
              style={{
                borderColor: colors.border,
                backgroundColor: control.enabled ? colors.primary + "22" : colors.background,
                flexBasis: "48%",
                flexGrow: 1,
                minWidth: 200,
                opacity: isUpdatingAutomation ? 0.6 : 1,
              }}
            >
              <View className="flex-row items-center justify-between gap-3">
                <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
                  {control.label}
                </Text>
                <Badge variant={control.enabled ? "success" : "warning"}>
                  {control.enabled ? "On" : "Off"}
                </Badge>
              </View>
              <Text className="mt-2 text-xs leading-5 text-muted">
                {control.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function ConfigurationManagementGroup({
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
      <View className="mt-3 flex-row flex-wrap gap-3">
        {group.sections.map((section) => (
          <ConfigurationSectionCard key={section.key} section={section} />
        ))}
      </View>
    </View>
  );
}

function ConfigurationSectionCard({
  section,
}: {
  section: MobileProjectConfigurationSection;
}) {
  const variant =
    section.status === "ready"
      ? "success"
      : section.status === "warning"
        ? "warning"
        : "danger";

  return (
    <View
      className="rounded-lg border p-3"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.background,
        flexBasis: "31%",
        flexGrow: 1,
        minWidth: 180,
      }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {section.title}
        </Text>
        <Badge variant={variant}>{section.status}</Badge>
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

function ProjectWorkItemRow({
  item,
  row,
  showDivider,
  onPress,
}: {
  item: ProjectWorkItem;
  row?: ReturnType<typeof buildProjectWorkItemRows>[number];
  showDivider: boolean;
  onPress: () => void;
}) {
  const action = row ?? {
    ...getProjectWorkItemAction(item),
    title: `${item.identifier} · ${item.title}`,
    subtitle: `${item.kind} · ${formatStatusLabel(item.status)}`,
    actionLabel: getProjectWorkItemAction(item).label,
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.identifier} ${item.title}`}
      className="flex-row items-center justify-between gap-3 px-3 py-3 active:opacity-75"
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colors.border,
      }}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
          {action.title}
        </Text>
        <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
          {action.subtitle}
        </Text>
      </View>
      <Text className="text-xs font-medium text-muted">{action.actionLabel}</Text>
    </Pressable>
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
