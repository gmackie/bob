import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

  const insets = useSafeAreaInsets();

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Stack.Screen options={{ title: post.title }} />
      <View className="h-full w-full p-4">
        <Text className="py-2 text-3xl font-bold text-primary">
          {post.title}
        </Text>
        <Text className="py-4 text-foreground">{post.content}</Text>
      </View>
    </View>
  );
}
