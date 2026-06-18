import { Text, View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import {
  formatStatusLabel,
  unwrapWorkItemDetail,
} from "~/features/tablet/queue";

const STATUS_COLORS: Record<string, string> = {
  in_progress: colors.success,
  in_review: colors.accent,
  blocked: colors.warning,
  done: colors.muted,
  cancelled: colors.muted2,
  backlog: colors.muted2,
  ready: colors.primary,
};

interface WorkItemPaneProps {
  workItemId: string;
  onOpenInspector?: () => void;
  onOpenSession?: (sessionId: string) => void;
}

export function WorkItemPane({ workItemId, onOpenInspector, onOpenSession }: WorkItemPaneProps) {
  const workItemQuery = useQuery(trpc.workItem.get.queryOptions(
    { id: workItemId },
    { enabled: Boolean(workItemId) },
  ));

  if (workItemQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  const item = unwrapWorkItemDetail(workItemQuery.data);
  if (!item) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <Text className="text-sm text-muted">Work item not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {item.title}
          </Text>
          <View className="mt-1 flex-row items-center">
            <Text className="text-xs text-muted">
              {item.identifier}
            </Text>
            <View
              className="mx-2 rounded-full px-2 py-0.5"
              style={{ backgroundColor: (STATUS_COLORS[item.status] ?? colors.muted) + "20" }}
            >
              <Text className="text-xs font-medium" style={{ color: STATUS_COLORS[item.status] ?? colors.muted }}>
                {formatStatusLabel(item.status)}
              </Text>
            </View>
            <Text className="text-xs text-muted2">
              {item.kind}
            </Text>
          </View>
        </View>
        {onOpenInspector && (
          <Pressable
            onPress={onOpenInspector}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
          >
            <Text className="text-xs font-medium text-foreground">
              Inspect
            </Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      <ScrollView className="flex-1 px-4 pt-4">
        {/* Description */}
        {item.description ? (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Description
            </Text>
            <Text className="text-sm leading-5 text-foreground">
              {item.description}
            </Text>
          </View>
        ) : null}

        {/* Artifacts */}
        {item.currentArtifacts && item.currentArtifacts.length > 0 && (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Artifacts
            </Text>
            {item.currentArtifacts.map((artifact) => (
              <View
                key={artifact.id}
                className="mb-2 rounded-lg px-3 py-2"
                style={{ backgroundColor: colors.card }}
              >
                <Text className="text-sm font-medium text-foreground">
                  {artifact.title ?? artifact.artifactRole}
                </Text>
                <Text className="text-xs text-muted">
                  {artifact.artifactType}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Planning sessions */}
        {item.sessions && item.sessions.length > 0 && (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Planning Sessions
            </Text>
            {item.sessions.map((session) => (
              <Pressable
                key={session.id}
                onPress={() => onOpenSession?.(session.id)}
                className="mb-2 flex-row items-center justify-between rounded-lg px-3 py-3 active:opacity-70"
                style={{ backgroundColor: colors.card, minHeight: 44 }}
              >
                <View>
                  <Text className="text-sm font-medium text-foreground">
                    {session.planningSessionType ?? "Session"}
                  </Text>
                  <Text className="text-xs text-muted">
                    {session.status}
                  </Text>
                </View>
                <Text className="text-xs font-medium text-primary">
                  {session.status === "running" || session.status === "idle" ? "Resume" : "View"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
