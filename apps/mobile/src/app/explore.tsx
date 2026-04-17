import { useState } from "react";
import {
  Text,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rpc } from "~/utils/api";

/* ------------------------------------------------------------------ */
/* Client-side types matching the JSON wire format                     */
/* ------------------------------------------------------------------ */

interface ExplorationCheckInWire {
  id: string;
  explorationId: string;
  summary: string;
  suggestedDirections: string[];
  articlesWritten: string[];
  depth: number;
  status: string;
}

interface ExplorationSummaryWire {
  id: string;
  threadId: string;
  topic: string;
  status: "running" | "paused" | "completed" | "awaiting_input";
  depth: number;
  articlesWrittenCount: number;
  lastCheckIn?: ExplorationCheckInWire;
}
import { Screen } from "~/components/ui/Screen";
import { Card } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { colors } from "~/lib/colors";

/* ------------------------------------------------------------------ */
/* Status badge mapping                                                */
/* ------------------------------------------------------------------ */

const statusVariant = {
  running: "success",
  paused: "warning",
  completed: "default",
  awaiting_input: "accent",
} as const;

/* ------------------------------------------------------------------ */
/* Check-in action card                                                */
/* ------------------------------------------------------------------ */

function CheckInActions({ exploration }: { exploration: ExplorationSummaryWire }) {
  const checkIn = exploration.lastCheckIn;
  const qc = useQueryClient();
  const [redirectTopic, setRedirectTopic] = useState("");
  const [showRedirect, setShowRedirect] = useState(false);

  const respondMutation = useMutation({
    mutationFn: rpc.exploration.respond,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["explorations"] }),
  });

  if (!checkIn) return null;

  const respond = (direction: string, topic?: string) => {
    respondMutation.mutate({
      explorationId: exploration.id,
      checkInId: checkIn.id,
      direction,
      ...(topic ? { redirectTopic: topic } : {}),
    });
    setShowRedirect(false);
    setRedirectTopic("");
  };

  return (
    <View className="mt-3 pt-3 border-t border-border">
      <Text className="text-sm mb-2" style={{ color: colors.foreground }}>
        {checkIn.summary}
      </Text>

      {checkIn.suggestedDirections.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mb-3">
          {checkIn.suggestedDirections.map((dir: string, i: number) => (
            <Badge key={i} variant="accent">{dir}</Badge>
          ))}
        </View>
      )}

      {checkIn.articlesWritten.length > 0 && (
        <View className="mb-3">
          <Text className="text-xs mb-1" style={{ color: colors.muted }}>
            Articles written
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {checkIn.articlesWritten.map((a: string, i: number) => (
              <Badge key={i} variant="default">{a}</Badge>
            ))}
          </View>
        </View>
      )}

      <View className="flex-row flex-wrap gap-2">
        <Button
          onPress={() => respond("continue")}
          size="sm"
          disabled={respondMutation.isPending}
        >
          Continue
        </Button>
        <Button
          onPress={() => respond("go_deeper")}
          variant="secondary"
          size="sm"
          disabled={respondMutation.isPending}
        >
          Go Deeper
        </Button>
        <Button
          onPress={() => setShowRedirect(!showRedirect)}
          variant="secondary"
          size="sm"
          disabled={respondMutation.isPending}
        >
          Redirect
        </Button>
        <Button
          onPress={() => respond("stop")}
          variant="ghost"
          size="sm"
          disabled={respondMutation.isPending}
        >
          Stop
        </Button>
      </View>

      {showRedirect && (
        <View className="flex-row items-center gap-2 mt-2">
          <TextInput
            value={redirectTopic}
            onChangeText={setRedirectTopic}
            placeholder="New direction..."
            placeholderTextColor={colors.muted}
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            style={{ color: colors.foreground }}
            onSubmitEditing={() => {
              if (redirectTopic.trim()) respond("redirect", redirectTopic.trim());
            }}
          />
          <Button
            onPress={() => {
              if (redirectTopic.trim()) respond("redirect", redirectTopic.trim());
            }}
            size="sm"
            disabled={!redirectTopic.trim() || respondMutation.isPending}
          >
            Go
          </Button>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Exploration card                                                    */
/* ------------------------------------------------------------------ */

function ExplorationCard({ item }: { item: ExplorationSummaryWire }) {
  const isAwaiting = item.status === "awaiting_input";

  return (
    <Card variant={isAwaiting ? "elevated" : "default"}>
      <View className="flex-row items-center justify-between mb-1">
        <Text
          className="text-base font-semibold flex-1 mr-2"
          style={{ color: colors.foreground }}
          numberOfLines={1}
        >
          {item.topic}
        </Text>
        <Badge variant={statusVariant[item.status]}>
          {item.status.replace("_", " ")}
        </Badge>
      </View>
      <View className="flex-row gap-4">
        <Text className="text-xs" style={{ color: colors.muted }}>
          Depth: {item.depth}
        </Text>
        <Text className="text-xs" style={{ color: colors.muted }}>
          Articles: {item.articlesWrittenCount}
        </Text>
      </View>

      {isAwaiting && <CheckInActions exploration={item} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export default function ExploreScreen() {
  const [topic, setTopic] = useState("");
  const qc = useQueryClient();

  const explorationsQuery = useQuery({
    queryKey: ["explorations"],
    queryFn: () => rpc.exploration.list(),
  });

  const startMutation = useMutation({
    mutationFn: rpc.exploration.start,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["explorations"] });
      setTopic("");
    },
    onError: (err) => {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to start exploration");
    },
  });

  const explorations = (explorationsQuery.data ?? []) as ExplorationSummaryWire[];

  // Sort: awaiting_input first, then running, paused, completed
  const sortOrder: Record<ExplorationSummaryWire["status"], number> = { awaiting_input: 0, running: 1, paused: 2, completed: 3 };
  const sorted = [...explorations].sort(
    (a, b) => (sortOrder[a.status] ?? 9) - (sortOrder[b.status] ?? 9),
  );

  const handleStart = () => {
    if (!topic.trim()) return;
    startMutation.mutate({
      threadId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      topic: topic.trim(),
    });
  };

  return (
    <Screen>
      <Text
        className="text-2xl font-bold mt-4 mb-4"
        style={{ color: colors.foreground }}
      >
        Explorations
      </Text>

      {/* Start form */}
      <Card className="mb-4">
        <TextInput
          value={topic}
          onChangeText={setTopic}
          placeholder="Explore a topic..."
          placeholderTextColor={colors.muted}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm mb-3"
          style={{ color: colors.foreground }}
          onSubmitEditing={handleStart}
        />
        <Button
          onPress={handleStart}
          disabled={!topic.trim() || startMutation.isPending}
        >
          {startMutation.isPending ? "Starting..." : "Start Exploration"}
        </Button>
      </Card>

      {explorationsQuery.isLoading && (
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={{ marginVertical: 20 }}
        />
      )}

      {explorationsQuery.isError && (
        <Text className="text-sm mb-4" style={{ color: colors.muted }}>
          Could not reach server
        </Text>
      )}

      <FlatList
        data={sorted}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 40 }}
        renderItem={({ item }) => <ExplorationCard item={item} />}
        ListEmptyComponent={
          !explorationsQuery.isLoading ? (
            <Text
              className="text-center text-sm mt-8"
              style={{ color: colors.muted }}
            >
              No explorations yet
            </Text>
          ) : null
        }
      />
    </Screen>
  );
}
