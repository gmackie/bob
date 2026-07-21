import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  buildMobileWorkItemEntryRunRows

} from "~/features/tablet/work-item-entry";
import type {MobileWorkItemOutcomeRun} from "~/features/tablet/work-item-entry";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

interface LinkedExecutionRunsCardProps {
  workItemId: string;
  workspaceId?: string | null;
  onOpenRun?: (href: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

export function LinkedExecutionRunsCard({
  workItemId,
  workspaceId,
  onOpenRun,
  onOpenSession,
}: LinkedExecutionRunsCardProps) {
  const runsQuery = useQuery(
    trpc.agentRun.listByWorkItem.queryOptions(
      { workItemId, limit: 20 },
      { enabled: Boolean(workItemId), refetchInterval: 10_000 },
    ),
  );
  const runs = Array.isArray(runsQuery.data)
    ? (runsQuery.data as MobileWorkItemOutcomeRun[])
    : [];
  const rows = buildMobileWorkItemEntryRunRows(runs, workspaceId);

  if (!runsQuery.isLoading && rows.length === 0) return null;

  return (
    <View
      className="mb-5 rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        Linked Runs
      </Text>
      <Text className="mt-1 text-base font-semibold text-foreground">
        Execution history
      </Text>

      {runsQuery.isLoading ? (
        <View className="mt-4 items-start">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : (
        <View
          className="mt-4 overflow-hidden rounded-lg border"
          style={{ borderColor: colors.border, backgroundColor: colors.background }}
        >
          {rows.map((row, index) => {
            const sessionId = row.sessionHref?.match(/^\/sessions\/([^?]+)/)?.[1] ?? null;
            const isActionable = Boolean(sessionId ?? onOpenRun);

            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.label}`}
                disabled={!isActionable}
                onPress={() => {
                  if (sessionId) {
                    onOpenSession?.(decodeURIComponent(sessionId));
                    return;
                  }
                  onOpenRun?.(row.runHref);
                }}
                className="flex-row items-center justify-between gap-3 px-3 py-3 active:opacity-70"
                style={{
                  borderBottomWidth: index === rows.length - 1 ? 0 : 1,
                  borderBottomColor: colors.border,
                  minHeight: 44,
                }}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {row.label}
                  </Text>
                  <Text className="text-xs text-muted">{row.statusLabel}</Text>
                </View>
                <Text className="text-xs font-semibold text-primary">
                  {sessionId || onOpenRun ? row.primaryActionLabel : "Recorded"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
