import { Pressable, Text, View } from "react-native";


import type { AgentMode } from "../agent-mode";

interface ModeToggleProps {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <View className="border-border bg-card flex-row rounded-xl border p-1">
      {(["bob", "ooda"] as const).map((item) => {
        const selected = item === mode;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            className={`rounded-lg px-4 py-2 ${selected ? "bg-primary" : "bg-transparent"}`}
          >
            <Text
              className={`text-sm font-semibold ${selected ? "text-primary-foreground" : "text-muted"}`}
            >
              {item === "bob" ? "Bob" : "OODA"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
