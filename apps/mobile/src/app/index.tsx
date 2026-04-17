import { Text, FlatList, Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { Thread } from "@gmacko/models";
import { Screen } from "~/components/ui/Screen";
import { Card } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { colors } from "~/lib/colors";

const mockThreads: Thread[] = [
  {
    id: "1",
    title: "AI Agent Architecture",
    status: "active",
    activeBranchId: "main",
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ["research", "agents"],
  },
  {
    id: "2",
    title: "Local LLM Inference",
    status: "active",
    activeBranchId: "main",
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ["ml", "local"],
  },
  {
    id: "3",
    title: "Knowledge Graph Design",
    status: "paused",
    activeBranchId: "branch-a",
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ["knowledge", "graph"],
  },
];

const statusVariant = {
  active: "success",
  paused: "warning",
  archived: "default",
  completed: "accent",
} as const;

export default function ThreadList() {
  return (
    <Screen>
      <Text className="text-2xl font-bold mt-4 mb-6" style={{ color: colors.foreground }}>
        Threads
      </Text>
      <FlatList
        data={mockThreads}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => (
          <Link href={`/thread/${item.id}`} asChild>
            <Pressable className="active:opacity-90">
              <Card>
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-lg font-semibold flex-1 mr-2" style={{ color: colors.foreground }}>
                    {item.title}
                  </Text>
                  <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
                </View>
                <View className="flex-row gap-2">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="accent">{tag}</Badge>
                  ))}
                </View>
              </Card>
            </Pressable>
          </Link>
        )}
      />
    </Screen>
  );
}
