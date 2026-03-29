import { SafeAreaView, Text, View } from "react-native";
import { Stack, useGlobalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import type { RouterOutputs } from "@bob/api";

import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";

type PostByIdOutput = RouterOutputs["post"]["byId"];

export default function Post() {
  const params = useGlobalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const postByIdProcedure = (trpc as unknown as {
    post?: {
      byId?: {
        queryOptions?: (input: { id: string }) => unknown;
      };
    };
  }).post?.byId;

  const postQueryOptions =
    id && postByIdProcedure?.queryOptions
      ? (postByIdProcedure.queryOptions({ id }) as object)
      : {
          queryKey: ["post", "byId", id ?? "missing-id"],
          queryFn: async () => null,
        };

  const { data } = useQuery<PostByIdOutput>({
    ...(postQueryOptions as object),
    enabled: Boolean(id && postByIdProcedure?.queryOptions),
  } as any);

  const post = data as PostByIdOutput;
  if (!post) return null;

  return (
    <SafeAreaView className="bg-background">
      <Stack.Screen options={{ title: post.title }} />
      <View className="h-full w-full p-4">
        <Text className="py-2 text-3xl font-bold" style={{ color: colors.primary }}>
          {post.title}
        </Text>
        <Text className="py-4" style={{ color: colors.foreground }}>{post.content}</Text>
      </View>
    </SafeAreaView>
  );
}
