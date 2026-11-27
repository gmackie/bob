import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@gmacko/core/contracts";
import { rpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { ThreadPane } from "~/components/tablet/ThreadPane";
import { ThreadSidebar } from "~/components/tablet/ThreadSidebar";
import { Button } from "~/components/ui/Button";
import { ExplorationsPane } from "./ExplorationsPane";
import type { ThreadRole } from "./workspace";
import { threadPaneVisibility } from "./workspace";

const sectionLabels: Record<ThreadRole, string> = {
  explorations: "Explorations",
  conversation: "Conversation",
};

export function ThreadWorkspace({
  threadId,
  role = "explorations",
}: {
  threadId?: string;
  role?: ThreadRole;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const visible = threadPaneVisibility(width, fontScale, threadId);
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: rpc.threads.list,
  });
  const selectThread = (id: string) => {
    if (threadId === id) return;
    const destination = {
      pathname: "/thread/[id]" as const,
      params: { id, section: "explorations" },
    };
    if (threadId) router.replace(destination);
    else router.push(destination);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View
        style={styles.row}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {visible.list && (
          <View
            key="list"
            style={visible.detail ? styles.sidebar : styles.fill}
          >
            <ThreadSidebar
              threads={threads.data ?? []}
              selectedThreadId={threadId ?? null}
              onSelectThread={selectThread}
              onRefresh={() => void threads.refetch()}
              isLoading={threads.isFetching}
              error={threads.isError}
            />
          </View>
        )}
        {visible.detail && (
          <View key="detail" style={styles.fill}>
            {threadId && !visible.list && (
              <Button variant="ghost" onPress={() => router.dismissTo("/")}>
                Back to threads
              </Button>
            )}
            {threadId ? (
              <SelectedThread
                key={threadId}
                threadId={threadId}
                role={role}
                initialThread={threads.data?.find(
                  (item) => item.id === threadId,
                )}
                updatedAt={threads.dataUpdatedAt}
              />
            ) : (
              <Text style={styles.notice}>
                Select a thread to see its explorations.
              </Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function SelectedThread({
  threadId,
  role,
  initialThread,
  updatedAt,
}: {
  threadId: string;
  role: ThreadRole;
  initialThread: Thread | undefined;
  updatedAt: number;
}) {
  const detail = useQuery({
    queryKey: ["threads", threadId],
    queryFn: () => rpc.threads.byId(threadId),
    initialData: initialThread,
    initialDataUpdatedAt: updatedAt,
  });
  const thread = detail.data;
  if (detail.isPending)
    return <ActivityIndicator accessibilityLabel="Loading thread" />;
  if (!thread)
    return (
      <View>
        <Text style={styles.notice}>Could not load this thread.</Text>
        <Button variant="secondary" onPress={() => void detail.refetch()}>
          Retry thread
        </Button>
      </View>
    );
  return (
    <View style={styles.fill}>
      <Text accessibilityRole="header" style={styles.title}>
        {thread.title}
      </Text>
      <View style={styles.tabs}>
        {(["explorations", "conversation"] as const).map((section) => (
          <Pressable
            key={section}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === role }}
            accessibilityLabel={sectionLabels[section]}
            onPress={() => router.setParams({ section })}
            style={[styles.tab, section === role && styles.selected]}
          >
            <Text style={styles.label}>{sectionLabels[section]}</Text>
          </Pressable>
        ))}
      </View>
      {role === "explorations" ? (
        <ExplorationsPane thread={thread} />
      ) : (
        <ThreadPane thread={thread} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: { flex: 1, flexDirection: "row" },
  fill: { flex: 1, minWidth: 0 },
  sidebar: {
    width: "38%",
    maxWidth: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  title: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: "700",
    marginHorizontal: 16,
    marginTop: 8,
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.cardElevated },
  label: { color: colors.foreground, fontWeight: "600" },
  notice: { margin: 16, color: colors.foreground },
});
