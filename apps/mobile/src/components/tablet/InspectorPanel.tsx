import { useState } from "react";
import { Text, View, ScrollView, Pressable, Animated, Dimensions, useWindowDimensions } from "react-native";

import { colors } from "~/lib/colors";

type InspectorTab = "artifact" | "details";

interface InspectorPanelProps {
  visible: boolean;
  onClose: () => void;
  artifactContent: string | null;
  workItemDetails?: {
    identifier: string;
    title: string;
    kind: string;
    status: string;
    description: string | null;
  } | null;
}

function TabButton({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center py-2 active:opacity-70"
      style={{
        borderBottomWidth: 2,
        borderBottomColor: isActive ? colors.accent : "transparent",
      }}
    >
      <Text
        className="text-xs font-medium"
        style={{ color: isActive ? colors.foreground : colors.muted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ArtifactView({ content }: { content: string | null }) {
  if (!content) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-sm" style={{ color: colors.muted }}>
          No artifact content yet
        </Text>
        <Text className="mt-1 text-center text-xs" style={{ color: colors.muted2 }}>
          Artifact content will appear as the agent produces output
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 px-4 py-3">
      <Text className="text-sm leading-5 font-mono" style={{ color: colors.foreground }}>
        {content}
      </Text>
    </ScrollView>
  );
}

function DetailsView({
  details,
}: {
  details: InspectorPanelProps["workItemDetails"];
}) {
  if (!details) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-sm" style={{ color: colors.muted }}>
          No work item selected
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 px-4 py-3">
      <View className="mb-4">
        <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
          Identifier
        </Text>
        <Text className="text-sm" style={{ color: colors.foreground }}>
          {details.identifier}
        </Text>
      </View>

      <View className="mb-4">
        <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
          Type
        </Text>
        <Text className="text-sm" style={{ color: colors.foreground }}>
          {details.kind}
        </Text>
      </View>

      <View className="mb-4">
        <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
          Status
        </Text>
        <Text className="text-sm" style={{ color: colors.foreground }}>
          {details.status.replace(/_/g, " ")}
        </Text>
      </View>

      {details.description && (
        <View className="mb-4">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
            Description
          </Text>
          <Text className="text-sm leading-5" style={{ color: colors.foreground }}>
            {details.description}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

export function InspectorPanel({
  visible,
  onClose,
  artifactContent,
  workItemDetails,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>("artifact");
  const { width: screenWidth } = useWindowDimensions();

  // Inspector takes ~40% of the main pane width
  const inspectorWidth = Math.min(screenWidth * 0.4, 400);

  if (!visible) return null;

  return (
    <View
      className="absolute right-0 top-0 bottom-0"
      style={{
        width: inspectorWidth,
        backgroundColor: colors.background,
        borderLeftWidth: 1,
        borderLeftColor: colors.border,
        // Elevation for slide-over effect
        shadowColor: "#000",
        shadowOffset: { width: -2, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-3 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Text className="text-sm font-semibold" style={{ color: colors.foreground }}>
          Inspector
        </Text>
        <Pressable
          onPress={onClose}
          className="rounded-md px-2 py-1 active:opacity-70"
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text className="text-xs" style={{ color: colors.muted }}>Close</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View className="flex-row" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TabButton label="Artifact" isActive={tab === "artifact"} onPress={() => setTab("artifact")} />
        <TabButton label="Details" isActive={tab === "details"} onPress={() => setTab("details")} />
      </View>

      {/* Content */}
      {tab === "artifact" ? (
        <ArtifactView content={artifactContent} />
      ) : (
        <DetailsView details={workItemDetails} />
      )}
    </View>
  );
}
