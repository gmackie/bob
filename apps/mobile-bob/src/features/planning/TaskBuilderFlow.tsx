import type { ReactNode } from "react";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useGlobalSearchParams, usePathname } from "expo-router";

import type { TaskPane } from "./task-builder";
import { colors } from "~/lib/colors";
import { canPairTaskPanes } from "./task-builder";
import { TaskExecutionPane } from "./TaskExecutionPane";

interface Props {
  workItemId: string;
  sessionId?: string | null;
  outcome: boolean;
  children: ReactNode;
  onOpenSession: (id: string) => void;
  onOpenRun: (href: string) => void;
}

const labels = { brief: "Task brief", builder: "Builder session" } as const;

export function TaskBuilderFlow({
  workItemId,
  sessionId,
  outcome,
  children,
  onOpenSession,
  onOpenRun,
}: Props) {
  const [messageDraft, setMessageDraft] = useState("");
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const { pane } = useGlobalSearchParams<{ pane?: string }>();
  const path = usePathname();
  const selected: TaskPane =
    pane === "brief" || pane === "builder"
      ? pane
      : outcome || path.endsWith("/workspace")
        ? "builder"
        : "brief";
  const paired = canPairTaskPanes(width, fontScale);
  return (
    <View
      style={styles.fill}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {!paired && (
        <View style={styles.tabs}>
          {(["brief", "builder"] as const).map((role) => (
            <Pressable
              key={role}
              accessibilityRole="tab"
              accessibilityLabel={labels[role]}
              accessibilityState={{ selected: role === selected }}
              onPress={() => router.setParams({ pane: role })}
              style={[styles.tab, role === selected && styles.active]}
            >
              <Text style={styles.label}>{labels[role]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[styles.fill, paired && styles.pair]}>
        <View
          style={[
            styles.fill,
            !paired && selected !== "brief" && styles.hidden,
          ]}
        >
          {children}
        </View>
        {width > 0 && (paired || selected === "builder") && (
          <View style={[styles.fill, paired && styles.result]}>
            <TaskExecutionPane
              key={workItemId}
              workItemId={workItemId}
              currentSessionId={sessionId}
              messageDraft={messageDraft}
              setMessageDraft={setMessageDraft}
              onOpenSession={onOpenSession}
              onOpenRun={onOpenRun}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  pair: { flexDirection: "row", gap: 12 },
  hidden: { display: "none" },
  result: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingLeft: 12,
  },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  active: { backgroundColor: colors.secondary },
  label: { color: colors.foreground, fontWeight: "600" },
});
