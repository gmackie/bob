import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Card } from "~/components/ui";
import {
  buildProviderRunSectionModels,
  filterProviderRuns,
  getProviderRunTarget,
  getProviderRunsScope



} from "~/features/tablet/dashboard";
import type {ProviderKey, ProviderRunRowModel, ProviderRunSectionModel} from "~/features/tablet/dashboard";
import type { MobileWorkItemEntryView } from "~/features/tablet/work-item-entry";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

interface ProviderRun {
  id: string;
  title?: string | null;
  status: string;
  agentType?: string | null;
  workItemId?: string | null;
  sessionId?: string | null;
  createdAt?: string | Date | null;
  completedAt?: string | Date | null;
  session?: {
    title?: string | null;
  } | null;
}

export function TabletProviderPane({
  provider,
  onOpenWorkItem,
  onOpenSession,
}: {
  provider: ProviderKey;
  onOpenWorkItem?: (workItemId: string, view?: MobileWorkItemEntryView) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { selectedWorkspaceId, workspace } = useSelectedWorkspace();
  const scope = getProviderRunsScope(selectedWorkspaceId);
  // agentRun.list and agentRun.listAll return differently-shaped rows
  // (workspace-scoped vs. global), so their queryOptions types don't unify.
  // Results are consumed as ProviderRun[] below; cast to one branch's shape.
  const runsQueryOptions = (
    scope.mode === "workspace"
      ? trpc.agentRun.list.queryOptions(
          { workspaceId: scope.workspaceId, limit: 100 },
          { enabled: true, refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 100 },
          { enabled: true, refetchInterval: 10_000 },
        )
  ) as ReturnType<typeof trpc.agentRun.listAll.queryOptions>;
  const runsQuery = useQuery(runsQueryOptions);
  const runs = useMemo(
    () => filterProviderRuns((runsQuery.data ?? []) as ProviderRun[], provider),
    [provider, runsQuery.data],
  );
  const sections = useMemo(() => buildProviderRunSectionModels(runs), [runs]);
  const metrics = useMemo(
    () => ({
      total: runs.length,
      active: sections.find((section) => section.key === "active")?.count ?? 0,
      failed: sections.find((section) => section.key === "failed")?.count ?? 0,
      completed: sections.find((section) => section.key === "completed")?.count ?? 0,
    }),
    [runs.length, sections],
  );
  const providerLabel = provider === "cursor-agent"
    ? "Cursor"
    : provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text className="text-sm uppercase tracking-[0.18em] text-muted">
            Provider
          </Text>
          <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {providerLabel}
          </Text>
          <Text className="mt-1 text-sm text-muted" numberOfLines={1}>
            {workspace?.name ?? "Workspace"} run history
          </Text>
        </View>
        <Badge variant={metrics.failed > 0 ? "danger" : "accent"}>
          {metrics.total} runs
        </Badge>
      </View>

      <View className="mt-6 flex-row gap-3">
        <Metric label="Total" value={metrics.total} />
        <Metric label="Active" value={metrics.active} tone="warning" />
        <Metric label="Failed" value={metrics.failed} tone="danger" />
        <Metric label="Done" value={metrics.completed} tone="success" />
      </View>

      {runsQuery.isLoading ? (
        <Card className="mt-6">
          <View className="items-center py-8">
            <ActivityIndicator color={colors.muted} />
          </View>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="mt-6">
          <Text className="text-sm text-muted">No {providerLabel} runs yet.</Text>
        </Card>
      ) : (
        <View className="mt-6 gap-4">
          {sections.map((section) => (
            <ProviderRunSection
              key={section.key}
              section={section}
              onOpenRun={(run) => openProviderRun(run, onOpenWorkItem, onOpenSession)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function openProviderRun(
  run: ProviderRun,
  onOpenWorkItem?: (workItemId: string, view?: MobileWorkItemEntryView) => void,
  onOpenSession?: (sessionId: string) => void,
) {
  const target = getProviderRunTarget(run);
  if (target.type === "work-item") {
    onOpenWorkItem?.(target.workItemId, target.view);
    return;
  }
  if (target.type === "execution-session") {
    onOpenSession?.(target.sessionId);
  }
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <View
      className="flex-1 rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted2">
        {label}
      </Text>
      <Text
        className="mt-2 text-2xl font-semibold"
        style={{
          color:
            tone === "success"
              ? colors.success
              : tone === "warning"
                ? colors.warning
                : tone === "danger"
                  ? colors.danger
                  : colors.foreground,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ProviderRunSection({
  section,
  onOpenRun,
}: {
  section: ProviderRunSectionModel<ProviderRun>;
  onOpenRun: (run: ProviderRun) => void;
}) {
  return (
    <View
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View
        className="flex-row items-center justify-between px-3 py-2"
        style={{ backgroundColor: colors.secondary }}
      >
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          {section.title}
        </Text>
        <Text className="text-xs font-semibold text-foreground">{section.count}</Text>
      </View>
      {section.rows.length > 0 ? (
        section.rows.map((row, index) => (
          <ProviderRunRow
            key={row.id}
            row={row}
            showDivider={index < section.rows.length - 1}
            onPress={() => onOpenRun(row.run)}
          />
        ))
      ) : (
        <Text className="p-4 text-sm text-muted">{section.emptyLabel}</Text>
      )}
    </View>
  );
}

function ProviderRunRow({
  row,
  showDivider,
  onPress,
}: {
  row: ProviderRunRowModel & { run: ProviderRun };
  showDivider: boolean;
  onPress: () => void;
}) {
  const target = getProviderRunTarget(row.run);
  const canOpen = target.type !== "none";

  return (
    <Pressable
      onPress={canOpen ? onPress : undefined}
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={canOpen ? `Open run ${row.accessibilityLabel}` : undefined}
      className="flex-row items-center justify-between gap-3 px-3 py-3 active:opacity-75"
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colors.border,
        opacity: canOpen ? 1 : 0.72,
      }}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
          {row.title}
        </Text>
        <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
          {row.agentLabel} · {row.lastUpdatedLabel}
        </Text>
      </View>
      <Badge variant={row.statusTone === "danger" ? "danger" : "accent"}>
        {row.statusLabel}
      </Badge>
    </Pressable>
  );
}
