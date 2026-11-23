import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "~/components/ui";
import { colors } from "~/lib/colors";
import { rpc } from "~/utils/api";
import { buildRunRecordView } from "./run-record-model";

/**
 * A run record, for runs with no session transcript to open.
 */

const TONE_COLOR = {
  running: colors.accent,
  attention: colors.warning,
  success: colors.success,
  failure: colors.danger,
  idle: colors.muted,
} as const;

export interface RunRecordViewProps {
  runId: string;
  onOpenSession?: (sessionId: string) => void;
  onOpenWorkItem?: (workItemId: string) => void;
}

function Action({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="items-center justify-center rounded-md px-4 active:opacity-70"
      style={{
        backgroundColor: primary ? colors.primary : colors.secondary,
        minHeight: 44,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: primary ? colors.background : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function RunRecordView({
  runId,
  onOpenSession,
  onOpenWorkItem,
}: RunRecordViewProps) {
  const runQuery = useQuery(
    rpc("agent.run.get").queryOptions(
      { runId },
      { enabled: Boolean(runId), retry: 1 },
    ),
  );

  if (runQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (!runQuery.data) {
    return (
      <View className="flex-1 px-4 pt-4">
        <EmptyState
          title="Run not found"
          hint="It may have been removed, or belong to a workspace you no longer have access to."
        />
      </View>
    );
  }

  const view = buildRunRecordView(runQuery.data);
  const toneColor = TONE_COLOR[view.tone];

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      <View
        className="mb-3 rounded-lg border p-4"
        style={{ borderColor: toneColor + "66", backgroundColor: colors.card }}
      >
        <View className="flex-row items-center gap-2">
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: toneColor }}
          />
          <Text
            className="text-xs font-semibold tracking-[0.16em] uppercase"
            style={{ color: toneColor }}
          >
            {view.statusLabel}
          </Text>
          <Text className="text-muted text-xs">· {view.title}</Text>
        </View>
        <Text className="text-foreground mt-2 text-base leading-6 font-semibold">
          {view.headline}
        </Text>
      </View>

      {view.facts.length > 0 ? (
        <View
          className="mb-3 rounded-lg border p-4"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          {view.facts.map((fact, index) => (
            <View
              key={fact.label}
              className="flex-row items-start justify-between gap-4 py-2"
              style={{
                borderBottomWidth: index === view.facts.length - 1 ? 0 : 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text className="text-muted text-xs font-semibold tracking-wider uppercase">
                {fact.label}
              </Text>
              {fact.url ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${fact.label}`}
                  onPress={() => {
                    WebBrowser.openBrowserAsync(fact.url ?? "").catch(
                      () => undefined,
                    );
                  }}
                  className="min-w-0 flex-1 items-end active:opacity-70"
                >
                  <Text
                    className="text-primary text-sm font-semibold"
                    numberOfLines={1}
                  >
                    {fact.value}
                  </Text>
                </Pressable>
              ) : (
                <Text
                  className="text-foreground min-w-0 flex-1 text-right text-sm"
                  numberOfLines={2}
                >
                  {fact.value}
                </Text>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {view.artifacts.length > 0 ? (
        <View
          className="mb-3 rounded-lg border p-4"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-muted text-xs font-semibold tracking-[0.16em] uppercase">
            Artifacts
          </Text>
          {view.artifacts.map((artifact) => (
            <View key={artifact.id} className="mt-2">
              <Text className="text-foreground text-sm font-semibold">
                {artifact.label}
              </Text>
              {artifact.detail ? (
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {artifact.detail}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        {view.sessionId && onOpenSession ? (
          <Action
            label="Open session"
            primary
            onPress={() => onOpenSession(view.sessionId ?? "")}
          />
        ) : null}
        {view.workItemId && onOpenWorkItem ? (
          <Action
            label="Open work item"
            onPress={() => onOpenWorkItem(view.workItemId ?? "")}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
