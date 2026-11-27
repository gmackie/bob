import { useLocalSearchParams } from "expo-router";
import { ThreadWorkspace } from "~/features/threads/ThreadWorkspace";

export default function ThreadScreen() {
  const { id, section } = useLocalSearchParams<{
    id: string;
    section?: string;
  }>();
  return (
    <ThreadWorkspace
      threadId={id}
      role={section === "explorations" ? "explorations" : "conversation"}
    />
  );
}
