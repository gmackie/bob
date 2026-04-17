import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import type { Thread } from "@gmacko/models";

const threads: Thread[] = [
  {
    id: "1",
    title: "AI Agent Architecture",
    status: "active",
    activeBranchId: "main",
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ["research"],
  },
];

export default function ThreadList() {
  return (
    <View style={styles.container}>
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <Link href={`/thread/${item.id}`} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.status}>{item.status}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: {
    backgroundColor: "#1a1a1f",
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2a2a2f",
  },
  title: { color: "#e8e4df", fontSize: 16, fontWeight: "600" },
  status: { color: "#d4a04a", fontSize: 12, marginTop: 4, textTransform: "uppercase" },
});
