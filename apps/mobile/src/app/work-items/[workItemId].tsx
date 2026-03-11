import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { getTaskWorkspaceHref } from "~/features/planning/navigation";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export default function WorkItemDetailScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ workItemId: string }>();
  const workItemId =
    typeof params.workItemId === "string" ? params.workItemId : "";
  const queryClient = useQueryClient();
  const [commentDraft, setCommentDraft] = useState("");

  const workItemQuery = useQuery(
    trpc.workItem.get.queryOptions(
      { id: workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const commentsQuery = useQuery(
    trpc.comment.listByWorkItem.queryOptions(
      { workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const createCommentMutation = useMutation(
    trpc.comment.create.mutationOptions({
      onSuccess: async () => {
        setCommentDraft("");
        await queryClient.invalidateQueries({
          queryKey: trpc.comment.listByWorkItem.queryKey({ workItemId }),
        });
      },
    }),
  );

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

  if (workItemQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!workItemQuery.data) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-foreground text-lg font-semibold">
            Work item not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const { workItem, currentArtifacts, childCount } = workItemQuery.data;

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5">
          <Text className="text-muted text-sm uppercase tracking-[0.18em]">
            {workItem.identifier}
          </Text>
          <Text className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
            {workItem.title}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge variant="accent">{workItem.kind}</Badge>
            <Badge>{workItem.status.replace(/_/g, " ")}</Badge>
            {workItem.project ? (
              <Badge variant="success">{workItem.project.key}</Badge>
            ) : null}
          </View>
        </View>

        {workItem.description ? (
          <Card className="mb-5">
            <Text className="text-foreground text-base font-semibold">
              Description
            </Text>
            <Text className="text-muted mt-3 text-sm leading-6">
              {workItem.description}
            </Text>
          </Card>
        ) : null}

        <Card variant="elevated" className="mb-5">
          <Text className="text-foreground text-lg font-semibold">
            Planning context
          </Text>
          <Text className="text-muted mt-3 text-sm">
            {childCount} child items · {currentArtifacts.length} current artifacts
          </Text>
          {workItem.kind === "task" ? (
            <Button
              className="mt-4"
              onPress={() =>
                router.push(getTaskWorkspaceHref(workItem.id) as never)
              }
            >
              Open task workspace
            </Button>
          ) : null}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">Artifacts</Text>
        </View>
        <Card className="mb-5">
          {currentArtifacts.length > 0 ? (
            currentArtifacts.map((artifact, index) => (
              <ListRow
                key={artifact.id}
                title={artifact.title ?? artifact.artifactRole}
                subtitle={artifact.url}
                showDivider={index < currentArtifacts.length - 1}
              />
            ))
          ) : (
            <Text className="text-muted text-sm">No artifacts attached yet.</Text>
          )}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">Comments</Text>
        </View>
        <Card className="mb-4">
          {commentsQuery.data?.length ? (
            commentsQuery.data.map((comment, index) => (
              <ListRow
                key={comment.id}
                title={comment.body}
                subtitle={new Date(comment.createdAt).toLocaleString()}
                showDivider={index < commentsQuery.data.length - 1}
              />
            ))
          ) : (
            <Text className="text-muted text-sm">No comments yet.</Text>
          )}
        </Card>

        <Card className="mb-8">
          <Text className="text-foreground text-base font-semibold">
            Add comment
          </Text>
          <TextInput
            value={commentDraft}
            onChangeText={setCommentDraft}
            multiline
            placeholder="Leave planning context or review guidance"
            placeholderTextColor="#7B8794"
            className="text-foreground border-border mt-3 min-h-24 rounded-2xl border px-4 py-3"
          />
          <Button
            className="mt-4"
            onPress={() =>
              createCommentMutation.mutate({
                workItemId,
                body: commentDraft,
              })
            }
            disabled={!commentDraft.trim() || createCommentMutation.isPending}
          >
            Post comment
          </Button>
        </Card>
      </ScrollView>
    </Screen>
  );
}
