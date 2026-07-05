import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Card, Screen } from "~/components/ui";
import {
  buildProviderRunGroups,
  buildProviderRunRowModel,
  filterProviderRuns,
  getMobileProviderRunHref,
  getProviderRunsScope,
  normalizeProviderKey,
} from "~/features/tablet/dashboard";
import { getMobileTasksDashboardHref } from "~/features/tablet/navigation";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";

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


function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <View className="flex-1">
      <Text className="text-xs uppercase tracking-[0.16em] text-muted2">
        {label}
      </Text>
      <Text
        className="mt-1 text-2xl font-semibold"
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

function ProviderRunRow({
  run,
  isLast,
  workspaceId,
}: {
  run: ProviderRun;
  isLast: boolean;
  workspaceId?: string | null;
}) {
  const href = getMobileProviderRunHref(run, workspaceId);
  const row = buildProviderRunRowModel(run);
  const badgeVariant =
    row.statusTone === "danger"
      ? "danger"
      : row.statusTone === "success"
        ? "success"
        : "accent";

  return (
    <Pressable
      accessibilityRole={href ? "button" : undefined}
      accessibilityLabel={href ? `Open run ${row.accessibilityLabel}` : undefined}
      onPress={href ? () => router.push(href as never) : undefined}
      className="py-3 active:opacity-70"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
        opacity: href ? 1 : 0.72,
      }}
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {row.title}
        </Text>
        <Badge variant={badgeVariant}>
          {row.statusLabel}
        </Badge>
      </View>
      <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
        {row.agentLabel} · {row.lastUpdatedLabel}
      </Text>
    </Pressable>
  );
}

function ProviderRunSection({
  title,
  runs,
  empty,
  workspaceId,
}: {
  title: string;
  runs: ProviderRun[];
  empty: string;
  workspaceId?: string | null;
}) {
  return (
    <Card className="mb-5">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-foreground">
          {title}
        </Text>
        <Text className="text-xs font-semibold text-muted">{runs.length}</Text>
      </View>
      {runs.length > 0 ? (
        runs.map((run, index) => (
          <ProviderRunRow
            key={run.id}
            run={run}
            isLast={index === runs.length - 1}
            workspaceId={workspaceId}
          />
        ))
      ) : (
        <Text className="mt-3 text-sm text-muted">
          {empty}
        </Text>
      )}
    </Card>
  );
}

export default function ProviderDetailScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ provider: string }>();
  const provider = normalizeProviderKey(params.provider);
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const scope = getProviderRunsScope(selectedWorkspaceId);

  // agentRun.list and agentRun.listAll return differently-shaped rows
  // (workspace-scoped vs. global), so their queryOptions types don't unify.
  // Results are consumed as ProviderRun[] below; cast to one branch's shape.
  const runsQueryOptions = (
    scope.mode === "workspace"
      ? trpc.agentRun.list.queryOptions(
          { workspaceId: scope.workspaceId, limit: 100 },
          { enabled: Boolean(session), refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 100 },
          { enabled: Boolean(session), refetchInterval: 10_000 },
        )
  ) as ReturnType<typeof trpc.agentRun.listAll.queryOptions>;
  const runsQuery = useQuery(runsQueryOptions);
  const runs = useMemo(
    () => filterProviderRuns((runsQuery.data ?? []) as ProviderRun[], provider),
    [provider, runsQuery.data],
  );
  const groups = useMemo(() => buildProviderRunGroups(runs), [runs]);

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

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5 flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-sm uppercase tracking-[0.18em] text-muted">
              Provider
            </Text>
            <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              {provider === "codex" ? "Codex" : "Cursor"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to tasks"
            onPress={() => router.replace(getMobileTasksDashboardHref(selectedWorkspaceId) as never)}
            className="rounded-md px-3 py-2 active:opacity-70"
            style={{ backgroundColor: colors.secondary }}
          >
            <Text className="text-sm font-semibold text-foreground">Tasks</Text>
          </Pressable>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold text-foreground">
            Session history
          </Text>
          <View className="mt-4 flex-row gap-3">
            <MetricCell label="Total" value={groups.metrics.total} />
            <MetricCell label="Active" value={groups.metrics.active} tone="warning" />
            <MetricCell label="Failed" value={groups.metrics.failed} tone="danger" />
            <MetricCell label="Done" value={groups.metrics.completed} tone="success" />
          </View>
        </Card>

        {runsQuery.isLoading ? (
          <Card className="mb-8">
            <View className="items-center py-8">
              <ActivityIndicator color={colors.muted} />
            </View>
          </Card>
        ) : runs.length > 0 ? (
          <>
            <ProviderRunSection
              title="Active Sessions"
              runs={groups.active}
              empty="No active sessions for this provider."
              workspaceId={selectedWorkspaceId}
            />
            <ProviderRunSection
              title="Failed Tasks"
              runs={groups.failed}
              empty="No failed task runs for this provider."
              workspaceId={selectedWorkspaceId}
            />
            <ProviderRunSection
              title="Completed Tasks"
              runs={groups.completed}
              empty="No completed task runs for this provider."
              workspaceId={selectedWorkspaceId}
            />
            {groups.other.length > 0 ? (
              <ProviderRunSection
                title="Other History"
                runs={groups.other}
                empty="No other provider history."
                workspaceId={selectedWorkspaceId}
              />
            ) : null}
          </>
        ) : (
          <Card className="mb-8">
            <Text className="text-sm text-muted">
              No {provider === "codex" ? "Codex" : "Cursor"} runs yet.
            </Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
