import React from "react";
import { View, Text, Pressable } from "react-native";
import { tw, colors } from "../lib/styles";

export type AgentStatus = "idle" | "working" | "paused";

interface AgentConfig {
  capabilities?: string[];
  avatar?: {
    primaryColor: string;
    accentColor: string;
    variant: "default" | "friendly" | "technical" | "creative";
  };
}

interface AgentStatusIndicatorProps {
  name: string | null;
  status?: AgentStatus;
  config?: AgentConfig | null;
  size?: "sm" | "md" | "lg";
  showStatus?: boolean;
  onPress?: () => void;
}

const statusColorMap: Record<AgentStatus, { bg: string; dot: string; text: string }> = {
  idle: { bg: colors["gray-100"], dot: colors["gray-400"], text: colors["gray-600"] },
  working: { bg: colors["green-100"], dot: colors["green-500"], text: colors["green-600"] },
  paused: { bg: "#FEF9C3", dot: colors["yellow-500"], text: "#A16207" },
};

const sizeConfig = {
  sm: { container: 24, text: 12, dot: 8 },
  md: { container: 32, text: 14, dot: 10 },
  lg: { container: 40, text: 16, dot: 12 },
};

const variantEmoji: Record<string, string> = {
  default: "R",
  friendly: "R",
  technical: "R",
  creative: "R",
};

export function AgentStatusIndicator({
  name,
  status = "idle",
  config,
  size = "md",
  showStatus = false,
  onPress,
}: AgentStatusIndicatorProps) {
  const statusColor = statusColorMap[status];
  const sizeClass = sizeConfig[size];
  const primaryColor = config?.avatar?.primaryColor ?? "#6366f1";
  const accentColor = config?.avatar?.accentColor ?? "#818cf8";

  const initial = name?.charAt(0)?.toUpperCase() ?? "A";

  const content = (
    <View style={tw("flex-row items-center")}>
      <View
        style={[
          tw("rounded-full items-center justify-center relative"),
          { width: sizeClass.container, height: sizeClass.container, backgroundColor: primaryColor }
        ]}
      >
        <Text style={[tw("font-bold text-white"), { fontSize: sizeClass.text }]}>{initial}</Text>
        {showStatus && (
          <View
            style={[
              tw("absolute rounded-full"),
              { 
                bottom: -2, 
                right: -2, 
                width: sizeClass.dot, 
                height: sizeClass.dot, 
                backgroundColor: statusColor.dot,
                borderWidth: 2,
                borderColor: colors.white
              }
            ]}
          />
        )}
      </View>
      {showStatus && (
        <View style={[tw("ml-2 px-2 rounded"), { backgroundColor: statusColor.bg, paddingVertical: 2 }]}>
          <Text style={[tw("text-xs font-medium capitalize"), { color: statusColor.text }]}>
            {status}
          </Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        {content}
      </Pressable>
    );
  }

  return content;
}

interface AgentBadgeProps {
  isAgent: boolean;
  isWorking?: boolean;
}

export function AgentBadge({ isAgent, isWorking = false }: AgentBadgeProps) {
  if (!isAgent) return null;

  return (
    <View
      style={[
        tw("rounded-full flex-row items-center"),
        { 
          paddingHorizontal: 6, 
          paddingVertical: 2,
          backgroundColor: isWorking ? colors["green-100"] : "#F3E8FF"
        }
      ]}
    >
      <Text style={tw("text-xs")}>{"<<"}</Text>
      <Text
        style={[
          tw("text-xs font-medium"),
          { color: isWorking ? colors["green-600"] : colors["purple-600"], marginHorizontal: 2 }
        ]}
      >
        AI
      </Text>
      <Text style={tw("text-xs")}>{">>"}</Text>
    </View>
  );
}
