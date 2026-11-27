import { type Dispatch, type SetStateAction, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExplorationDirection, Thread } from "@gmacko/core/contracts";
import { rpc } from "~/utils/api";
import { Card } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { colors } from "~/lib/colors";
import {
  startExplorationInput,
  threadExplorations,
  type Exploration,
} from "./workspace";

const statusVariant = {
  running: "success",
  paused: "warning",
  completed: "default",
  awaiting_input: "accent",
} as const;

/* ------------------------------------------------------------------ */
/* Check-in action card                                                */
/* ------------------------------------------------------------------ */

interface RedirectDraft {
  checkInId: string;
  text: string;
}

function CheckInActions({
  exploration,
  redirect,
  setRedirect,
}: {
  exploration: Exploration;
  redirect: RedirectDraft | null;
  setRedirect: Dispatch<SetStateAction<RedirectDraft | null>>;
}) {
  const checkIn = exploration.lastCheckIn;
  const qc = useQueryClient();
  const showRedirect = !!checkIn && redirect?.checkInId === checkIn.id;
  const redirectTopic = showRedirect ? redirect.text : "";

  const respondMutation = useMutation({
    mutationFn: rpc.exploration.respond,
    onSuccess: async (_, response) => {
      setRedirect((current) =>
        current?.checkInId === response.checkInId ? null : current,
      );
      await qc.invalidateQueries({ queryKey: ["explorations"] });
    },
  });

  if (!checkIn) return null;

  const respond = (direction: ExplorationDirection, topic?: string) => {
    if (respondMutation.isPending) return;
    respondMutation.mutate({
      explorationId: exploration.id,
      checkInId: checkIn.id,
      direction,
      ...(topic ? { redirectTopic: topic } : {}),
    });
  };

  return (
    <View className="mt-3 pt-3 border-t border-border">
      <Text className="text-sm mb-2" style={{ color: colors.foreground }}>
        {checkIn.summary}
      </Text>

      {checkIn.suggestedDirections.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mb-3">
          {[...new Set(checkIn.suggestedDirections)].map((dir) => (
            <Badge key={dir} variant="accent">
              {dir}
            </Badge>
          ))}
        </View>
      )}

      {checkIn.articlesWritten.length > 0 && (
        <View className="mb-3">
          <Text className="text-xs mb-1" style={{ color: colors.muted }}>
            Articles written
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {[...new Set(checkIn.articlesWritten)].map((a) => (
              <Badge key={a} variant="default">
                {a}
              </Badge>
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
          onPress={() =>
            setRedirect(
              showRedirect ? null : { checkInId: checkIn.id, text: "" },
            )
          }
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

      {respondMutation.isError && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          Response failed. Try again.
        </Text>
      )}
      {showRedirect && (
        <View className="flex-row items-center gap-2 mt-2">
          <TextInput
            value={redirectTopic}
            accessibilityLabel="New check-in direction"
            onChangeText={(text) =>
              setRedirect({ checkInId: checkIn.id, text })
            }
            placeholder="New direction..."
            placeholderTextColor={colors.muted}
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            style={{ color: colors.foreground }}
            onSubmitEditing={() => {
              if (redirectTopic.trim())
                respond("redirect", redirectTopic.trim());
            }}
          />
          <Button
            accessibilityLabel="Submit new direction"
            onPress={() => {
              if (redirectTopic.trim())
                respond("redirect", redirectTopic.trim());
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

function ExplorationCard({
  item,
  redirect,
  setRedirect,
  showThread,
}: {
  item: Exploration;
  redirect: RedirectDraft | null;
  setRedirect: Dispatch<SetStateAction<RedirectDraft | null>>;
  showThread: boolean;
}) {
  const isAwaiting = item.status === "awaiting_input";

  return (
    <Card variant={isAwaiting ? "elevated" : "default"}>
      <View className="flex-row items-center justify-between mb-1">
        <Text
          className="text-base font-semibold flex-1 mr-2"
          style={{ color: colors.foreground }}
        >
          {item.topic}
        </Text>
        <Badge variant={statusVariant[item.status]}>
          {item.status.replace("_", " ")}
        </Badge>
      </View>
      <View className="flex-row flex-wrap gap-4">
        <Text className="text-xs" style={{ color: colors.muted }}>
          Depth: {item.depth}
        </Text>
        <Text className="text-xs" style={{ color: colors.muted }}>
          Articles: {item.articlesWrittenCount}
        </Text>
      </View>

      {isAwaiting && (
        <CheckInActions
          exploration={item}
          redirect={redirect}
          setRedirect={setRedirect}
        />
      )}
      {showThread && (
        <Button
          variant="ghost"
          onPress={() =>
            router.push({
              pathname: "/thread/[id]",
              params: { id: item.threadId, section: "explorations" },
            })
          }
        >
          Open thread
        </Button>
      )}
    </Card>
  );
}

export function ExplorationsPane({ thread }: { thread?: Thread }) {
  const [topic, setTopic] = useState("");
  const [redirect, setRedirect] = useState<RedirectDraft | null>(null);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["explorations"],
    queryFn: rpc.exploration.list,
  });
  const start = useMutation({
    mutationFn: rpc.exploration.start,
    onSuccess: async (_, input) => {
      setTopic((current) => (current.trim() === input.topic ? "" : current));
      await qc.invalidateQueries({ queryKey: ["explorations"] });
    },
  });
  const input = thread && startExplorationInput(thread, topic);
  const submit = () => {
    if (input && !start.isPending) start.mutate(input);
  };

  return (
    <FlatList
      data={threadExplorations(query.data ?? [], thread?.id)}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 12, paddingBottom: 24, gap: 12 }}
      ListHeaderComponent={
        thread ? (
          <Card>
            <TextInput
              value={topic}
              onChangeText={setTopic}
              accessibilityLabel="Exploration topic"
              placeholder="Explore a topic…"
              placeholderTextColor={colors.muted}
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm mb-3"
              style={{ color: colors.foreground, minHeight: 44 }}
              onSubmitEditing={submit}
            />
            <Button onPress={submit} disabled={!input || start.isPending}>
              {start.isPending ? "Starting…" : "Start exploration"}
            </Button>
            {!thread.activeBranchId && (
              <Text style={{ color: colors.muted }}>
                This thread has no active branch.
              </Text>
            )}
            {start.isError && (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                Could not start the exploration. Try again.
              </Text>
            )}
          </Card>
        ) : (
          <Button variant="secondary" onPress={() => router.dismissTo("/")}>
            Choose a thread to start an exploration
          </Button>
        )
      }
      renderItem={({ item }) => (
        <ExplorationCard
          item={item}
          redirect={redirect}
          setRedirect={setRedirect}
          showThread={!thread}
        />
      )}
      ListEmptyComponent={
        query.isPending ? (
          <ActivityIndicator accessibilityLabel="Loading explorations" />
        ) : !query.isError ? (
          <Text style={{ color: colors.muted }}>No explorations yet.</Text>
        ) : undefined
      }
      ListFooterComponent={
        query.isError ? (
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Could not load explorations. Retry
          </Button>
        ) : undefined
      }
    />
  );
}
