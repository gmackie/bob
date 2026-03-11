import { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { tw, colors } from "../lib/styles";

interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

interface LabelsPickerProps {
  visible: boolean;
  selectedLabelIds: string[];
  onSelect: (labelIds: string[]) => void;
  onClose: () => void;
}

export function LabelsPicker({
  visible,
  selectedLabelIds,
  onSelect,
  onClose,
}: LabelsPickerProps) {
  const { workspaceId, teamId } = useWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [localSelection, setLocalSelection] = useState<string[]>(selectedLabelIds);

  const { data: labels, isLoading } = trpc.label.listFlat.useQuery(
    { workspaceId, teamId },
    { enabled: visible && !!workspaceId }
  );

  const filteredLabels = labels?.filter((label) => {
    if (!searchQuery) return true;
    return label.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const toggleLabel = (labelId: string) => {
    setLocalSelection((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId]
    );
  };

  const handleDone = () => {
    onSelect(localSelection);
    setSearchQuery("");
    onClose();
  };

  const handleClose = () => {
    setLocalSelection(selectedLabelIds);
    setSearchQuery("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={tw("flex-1 bg-white")}>
        <View style={tw("flex-row items-center justify-between border-b border-gray-200 px-4 py-3")}>
          <Pressable onPress={handleClose}>
            <Text style={tw("text-gray-500")}>Cancel</Text>
          </Pressable>
          <Text style={tw("font-semibold text-gray-900")}>Labels</Text>
          <Pressable onPress={handleDone}>
            <Text style={tw("text-indigo-600 font-medium")}>Done</Text>
          </Pressable>
        </View>

        <View style={tw("px-4 py-3 border-b border-gray-100")}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search labels..."
            placeholderTextColor="#9ca3af"
            style={[tw("bg-gray-100 rounded-lg px-4 text-gray-900"), { paddingVertical: 10 }]}
            autoCapitalize="none"
          />
        </View>

        {isLoading ? (
          <View style={tw("flex-1 items-center justify-center")}>
            <ActivityIndicator size="large" color="#4F46E5" />
          </View>
        ) : (
          <ScrollView style={tw("flex-1")}>
            {filteredLabels?.map((label) => {
              const isSelected = localSelection.includes(label.id);
              return (
                <Pressable
                  key={label.id}
                  onPress={() => toggleLabel(label.id)}
                  style={[
                    tw("flex-row items-center px-4 py-3 border-b border-gray-100"),
                    isSelected && { backgroundColor: colors["indigo-100"] }
                  ]}
                >
                  <View
                    style={[tw("h-4 w-4 rounded-full mr-3"), { backgroundColor: label.color }]}
                  />
                  <View style={tw("flex-1")}>
                    <Text
                      style={
                        isSelected ? tw("text-indigo-600 font-medium") : tw("text-gray-900")
                      }
                    >
                      {label.name}
                    </Text>
                    {label.description && (
                      <Text style={tw("text-gray-500 text-sm")} numberOfLines={1}>
                        {label.description}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      tw("h-5 w-5 rounded border-2 items-center justify-center"),
                      isSelected
                        ? { backgroundColor: colors["indigo-600"], borderColor: colors["indigo-600"] }
                        : { borderColor: colors["gray-300"] }
                    ]}
                  >
                    {isSelected && <Text style={tw("text-white text-xs")}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}

            {filteredLabels?.length === 0 && (
              <View style={tw("items-center py-8")}>
                <Text style={tw("text-gray-400")}>No labels found</Text>
              </View>
            )}
          </ScrollView>
        )}

        {localSelection.length > 0 && (
          <View style={tw("border-t border-gray-200 px-4 py-3")}>
            <Text style={tw("text-sm text-gray-500")}>
              {localSelection.length} label{localSelection.length !== 1 ? "s" : ""}{" "}
              selected
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
