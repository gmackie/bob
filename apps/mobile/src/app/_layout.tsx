import { useState, useCallback } from "react";
import { Platform, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient, rpc } from "~/utils/api";
import { ThreadSidebar } from "~/components/tablet/ThreadSidebar";
import { ThreadPane } from "~/components/tablet/ThreadPane";
import { colors } from "~/lib/colors";
import type { Thread, Message } from "@gmacko/contracts";

import "../styles.css";

let SplitView: any = null;
if (Platform.OS === "ios") {
  try {
    const mod = require("expo-router/build/split-view");
    SplitView = mod.SplitView;
  } catch {}
}

const isTablet = Platform.OS === "ios" && Platform.isPad;

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: "#111113" },
  animation: "fade" as const,
};

function PhoneLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}

function TabletLayout() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const threadsQuery = useQuery({
    queryKey: ["threads"],
    queryFn: () => rpc.threads.list(),
  });
  const threads = (threadsQuery.data ?? []) as Thread[];

  const selectedThread = threads.find((t) => t.id === selectedThreadId);

  const messagesQuery = useQuery({
    queryKey: ["messages", selectedThreadId, selectedThread?.activeBranchId],
    queryFn: () =>
      rpc.messages.listByBranch(
        selectedThreadId!,
        selectedThread!.activeBranchId,
      ),
    enabled: !!selectedThreadId && !!selectedThread?.activeBranchId,
  });
  const messages = (messagesQuery.data ?? []) as Message[];

  const handleRefresh = useCallback(() => {
    void threadsQuery.refetch();
  }, [threadsQuery]);

  const handleSend = useCallback(
    (_content: string) => {
      // Will be wired to rpc.agent.chat mutation in a follow-up task
    },
    [],
  );

  if (!SplitView) return <PhoneLayout />;

  return (
    <SplitView>
      <SplitView.Column>
        <View className="flex-1 bg-background border-r border-border">
          <ThreadSidebar
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={setSelectedThreadId}
            onRefresh={handleRefresh}
            isLoading={threadsQuery.isFetching}
          />
        </View>
      </SplitView.Column>
      <SplitView.Column>
        <View className="flex-1 bg-background">
          {selectedThread ? (
            <ThreadPane
              threadTitle={selectedThread.title}
              branchName="main"
              messages={messages}
              onSend={handleSend}
              onSynthesize={() => {}}
              isLoading={messagesQuery.isFetching}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text style={{ color: colors.muted }}>
                Select a thread to begin
              </Text>
            </View>
          )}
        </View>
      </SplitView.Column>
    </SplitView>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      {isTablet ? <TabletLayout /> : <PhoneLayout />}
      <StatusBar style="light" />
    </QueryClientProvider>
  );
}
