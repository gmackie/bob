import { useCallback, useState } from "react";
import { colors } from "~/lib/colors";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";


interface Thread {
  id: string;
  title: string;
  slug: string;
  status: string;
}

interface ThreadPickerProps {
  threads: Thread[];
  selectedId: string | null;
  onSelect: (threadId: string) => void;
  onCreate: (title: string) => Promise<void>;
  visible: boolean;
  onClose: () => void;
}

export function ThreadPicker({
  threads,
  selectedId,
  onSelect,
  onCreate,
  visible,
  onClose,
}: ThreadPickerProps) {
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      await onCreate(trimmed);
      setNewTitle("");
      onClose();
    } finally {
      setCreating(false);
    }
  }, [creating, newTitle, onCreate, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background pt-6 px-5">
        <View className="mb-5 flex-row items-center justify-between">
          <Text className="text-xl font-semibold text-foreground">
            OODA Threads
          </Text>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-base font-semibold text-muted">
              Done
            </Text>
          </Pressable>
        </View>

        <View className="border-border mb-5 rounded-xl border p-3">
          <TextInput
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="New thread title..."
            placeholderTextColor={colors.muted2}
            className="text-base text-foreground"
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Pressable
            onPress={handleCreate}
            disabled={!newTitle.trim() || creating}
            className="bg-primary mt-3 rounded-lg py-2.5 active:opacity-80 disabled:opacity-50"
          >
            <Text
              className="text-center text-sm font-semibold text-primary-foreground"
            >
              {creating ? "Creating..." : "Create Thread"}
            </Text>
          </Pressable>
        </View>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {threads.map((thread) => {
            const selected = thread.id === selectedId;
            return (
              <Pressable
                key={thread.id}
                onPress={() => {
                  onSelect(thread.id);
                  onClose();
                }}
                className={`border-border mb-2 rounded-xl border p-4 active:opacity-80 ${
                  selected ? "bg-primary/10 border-primary" : "bg-card"
                }`}
              >
                <Text
                  className="text-base font-semibold text-foreground"
                >
                  {thread.title}
                </Text>
                <View className="mt-1 flex-row items-center gap-2">
                  <Text className="text-xs text-muted">
                    {thread.slug}
                  </Text>
                  <View
                    className={`h-1.5 w-1.5 rounded-full ${
                      thread.status === "active" ? "bg-success" : "bg-muted"
                    }`}
                  />
                  <Text className="text-xs text-muted2">
                    {thread.status}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {threads.length === 0 ? (
            <Text className="text-center text-sm text-muted">
              No threads yet. Create one above.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

