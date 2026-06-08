import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  buildMobileReadableOutcomeRows,
  selectLatestMobileSessionBackedOutcomeRun,
  type MobileReadableOutcomeEvent,
  type MobileWorkItemOutcomeRun,
} from "~/features/tablet/work-item-entry";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

interface OutcomeReadableOutputCardProps {
  workItemId: string;
  onOpenSession?: (sessionId: string) => void;
}

export function OutcomeReadableOutputCard({
  workItemId,
  onOpenSession,
}: OutcomeReadableOutputCardProps) {
  const runsQuery = useQuery(
    trpc.agentRun.listByWorkItem.queryOptions(
      { workItemId, limit: 10 },
      { enabled: Boolean(workItemId), refetchInterval: 10_000 },
    ),
  );
  const runs = Array.isArray(runsQuery.data)
    ? (runsQuery.data as MobileWorkItemOutcomeRun[])
    : [];
  const latestRun = selectLatestMobileSessionBackedOutcomeRun(runs);
  const sessionId = latestRun?.sessionId ?? "";
  const eventsQuery = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId, limit: 200 },
      { enabled: Boolean(sessionId), refetchInterval: 5_000 },
    ),
  );
  const events = getEventList(eventsQuery.data);
  const rows = buildMobileReadableOutcomeRows(events);
  const isLoading = runsQuery.isLoading || (Boolean(sessionId) && eventsQuery.isLoading);

  return (
    <View
      className="mb-5 rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Readable Output
          </Text>
          <Text className="mt-1 text-base font-semibold text-foreground">
            Latest execution session
          </Text>
        </View>
        {sessionId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open execution session"
            onPress={() => onOpenSession?.(sessionId)}
            className="rounded-md px-3 py-2 active:opacity-70"
            style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
          >
            <Text className="text-xs font-semibold text-foreground">Open session</Text>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View className="mt-4 items-start">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : !latestRun ? (
        <Text className="mt-4 rounded-md border px-3 py-3 text-sm text-muted">
          No execution session has been linked to this outcome yet.
        </Text>
      ) : rows.length === 0 ? (
        <Text className="mt-4 rounded-md px-3 py-3 text-sm text-muted">
          No readable session output has been recorded yet.
        </Text>
      ) : (
        <View
          className="mt-4 overflow-hidden rounded-lg border"
          style={{ borderColor: colors.border, backgroundColor: colors.background }}
        >
          {rows.map((row, index) => (
            <View
              key={row.id}
              className="px-3 py-3"
              style={{
                borderBottomWidth: index === rows.length - 1 ? 0 : 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text className="mb-1 text-xs font-semibold text-muted">{row.label}</Text>
              <Text className="text-sm leading-5 text-foreground" numberOfLines={5}>
                {row.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function getEventList(value: unknown): MobileReadableOutcomeEvent[] {
  if (Array.isArray(value)) return value as MobileReadableOutcomeEvent[];
  const record = value as { events?: unknown } | null | undefined;
  return Array.isArray(record?.events)
    ? (record.events as MobileReadableOutcomeEvent[])
    : [];
}
