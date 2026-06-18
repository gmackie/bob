import { useState } from "react";
import { Text, View, ScrollView, Pressable, useWindowDimensions } from "react-native";

import type { FileReference } from "~/lib/file-references";
import { CodeViewer } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import { TaskTree } from "./TaskTree";
import { colors } from "~/lib/colors";

type InspectorTab = "files" | "artifact" | "tasks" | "details";

export interface InspectorPanelProps {
  visible: boolean;
  onClose: () => void;
  artifactContent: string | null;
  fileReferences: FileReference[];
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  workItemId?: string | null;
  workItemDetails?: {
    identifier: string;
    title: string;
    kind: string;
    status: string;
    description: string | null;
  } | null;
}

function TabButton({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center py-2 active:opacity-70"
      style={{ borderBottomWidth: 2, borderBottomColor: isActive ? colors.accent : "transparent" }}
    >
      <Text className="text-xs font-medium" style={{ color: isActive ? colors.foreground : colors.muted }}>
        {label}
      </Text>
    </Pressable>
  );
}

const ACTION_COLORS: Record<string, string> = {
  read: colors.muted,
  write: colors.success,
  edit: colors.warning,
  glob: colors.accent,
  grep: colors.accent,
  bash: colors.muted2,
  unknown: colors.muted2,
};

function FilesView({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: FileReference[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const selected = selectedPath ? files.find((f) => f.path === selectedPath) : null;

  // If a file is selected and has content, show the viewer
  if (selected?.content) {
    const isDiff = selected.content.includes("@@") && (selected.content.includes("+++ ") || selected.content.startsWith("diff "));
    if (isDiff) {
      return <DiffViewer diff={selected.content} filePath={selected.shortPath} />;
    }
    return <CodeViewer content={selected.content} filePath={selected.shortPath} />;
  }

  // File list
  if (files.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-sm text-muted">No files referenced</Text>
        <Text className="mt-1 text-center text-xs text-muted2">
          File references from agent tool calls will appear here
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      {files.map((file) => (
        <Pressable
          key={`${file.path}-${file.seq}`}
          onPress={() => onSelectFile(file.path)}
          className="flex-row items-center px-3 py-2.5 active:opacity-70"
          style={{
            minHeight: 44,
            backgroundColor: file.path === selectedPath ? colors.cardElevated : "transparent",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View
            className="mr-2 rounded px-1.5 py-0.5"
            style={{ backgroundColor: (ACTION_COLORS[file.action] ?? colors.muted) + "20" }}
          >
            <Text className="text-[10px] font-bold uppercase" style={{ color: ACTION_COLORS[file.action] ?? colors.muted }}>
              {file.action}
            </Text>
          </View>
          <Text className="flex-1 text-xs font-mono text-foreground" numberOfLines={1}>
            {file.shortPath}
          </Text>
          {file.content && (
            <Text className="text-[10px] text-muted2">
              {file.content.split("\n").length}L
            </Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ArtifactView({ content }: { content: string | null }) {
  if (!content) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-sm text-muted">No artifact content yet</Text>
      </View>
    );
  }
  return (
    <ScrollView className="flex-1 px-4 py-3">
      <Text className="text-sm leading-5 font-mono text-foreground">{content}</Text>
    </ScrollView>
  );
}

function DetailsView({ details }: { details: InspectorPanelProps["workItemDetails"] }) {
  if (!details) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-sm text-muted">No work item selected</Text>
      </View>
    );
  }
  return (
    <ScrollView className="flex-1 px-4 py-3">
      {[
        { label: "Identifier", value: details.identifier },
        { label: "Type", value: details.kind },
        { label: "Status", value: details.status.replace(/_/g, " ") },
      ].map(({ label, value }) => (
        <View key={label} className="mb-4">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{label}</Text>
          <Text className="text-sm text-foreground">{value}</Text>
        </View>
      ))}
      {details.description && (
        <View className="mb-4">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Description</Text>
          <Text className="text-sm leading-5 text-foreground">{details.description}</Text>
        </View>
      )}
    </ScrollView>
  );
}

export function InspectorPanel({
  visible,
  onClose,
  artifactContent,
  fileReferences,
  selectedFilePath,
  onSelectFile,
  workItemId,
  workItemDetails,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>("files");
  const { width: screenWidth } = useWindowDimensions();
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
        shadowColor: "#000",
        shadowOffset: { width: -2, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-3 py-2" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text className="text-sm font-semibold text-foreground">Inspector</Text>
        <Pressable onPress={onClose} className="rounded-md px-2 py-1 active:opacity-70" style={{ minHeight: 44, justifyContent: "center" }}>
          <Text className="text-xs text-muted">Close</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View className="flex-row" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TabButton label="Files" isActive={tab === "files"} onPress={() => setTab("files")} />
        <TabButton label="Artifact" isActive={tab === "artifact"} onPress={() => setTab("artifact")} />
        <TabButton label="Tasks" isActive={tab === "tasks"} onPress={() => setTab("tasks")} />
        <TabButton label="Details" isActive={tab === "details"} onPress={() => setTab("details")} />
      </View>

      {/* Content */}
      {tab === "files" ? (
        <FilesView files={fileReferences} selectedPath={selectedFilePath} onSelectFile={onSelectFile} />
      ) : tab === "artifact" ? (
        <ArtifactView content={artifactContent} />
      ) : tab === "tasks" ? (
        workItemId ? (
          <ScrollView className="flex-1">
            <TaskTree workItemId={workItemId} />
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center px-4">
            <Text className="text-sm text-muted">Select a work item to see subtasks</Text>
          </View>
        )
      ) : (
        <DetailsView details={workItemDetails} />
      )}
    </View>
  );
}
