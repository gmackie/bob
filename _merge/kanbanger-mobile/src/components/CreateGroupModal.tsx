import { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { successHaptic, selectionHaptic } from "../lib/haptics";
import { Button, ButtonText } from "@linear-clone/ui-native";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

interface CreateGroupModalProps {
  visible: boolean;
  onClose: () => void;
  onGroupCreated: (groupId: string) => void;
}

const GROUP_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#8B5CF6",
];

export function CreateGroupModal({
  visible,
  onClose,
  onGroupCreated,
}: CreateGroupModalProps) {
  const { workspaceId } = useWorkspace();
  const { colors, isDark } = useTheme();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[0]);

  const createMutation = trpc.projectGroup.create.useMutation({
    onSuccess: (data) => {
      successHaptic();
      utils.projectGroup.list.invalidate();
      utils.project.list.invalidate();
      resetForm();
      if (data) {
        onGroupCreated(data.id);
      }
    },
    onError: (error) => {
      console.error("Failed to create group:", error.message);
    },
  });

  const resetForm = () => {
    setName("");
    setSelectedColor(GROUP_COLORS[0]);
  };

  useEffect(() => {
    if (visible) {
      resetForm();
    }
  }, [visible]);

  const handleCreate = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      workspaceId,
      name: name.trim(),
      color: selectedColor,
    });
  };

  const handleClose = () => {
    resetForm();
    createMutation.reset();
    onClose();
  };

  const canCreate = name.trim().length > 0 && !!workspaceId && !createMutation.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        testID="create-group-modal"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[tw("flex-1"), { backgroundColor: colors.background }]}
      >
        <View
          style={[
            tw("flex-row items-center justify-between border-b px-4 py-3"),
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable testID="create-group-close" onPress={handleClose} style={tw("p-2")}>
            <Text style={[tw("font-medium"), { color: colors.primary }]}>Cancel</Text>
          </Pressable>
          <Text style={[tw("text-lg font-semibold"), { color: colors.text }]}>New Group</Text>
          <View style={{ width: 64 }} />
        </View>

        <View style={tw("flex-1 px-4")}>
          <View style={tw("mt-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Name *</Text>
            <TextInput
              testID="create-group-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Group name"
              placeholderTextColor={colors.textTertiary}
              style={[
                tw("text-lg font-medium rounded-lg px-3 py-3"),
                { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"], color: colors.text },
              ]}
              autoFocus
            />
          </View>

          <View style={tw("mt-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Color</Text>
            <View style={tw("flex-row gap-3")}>
              {GROUP_COLORS.map((color) => (
                <Pressable
                  key={color}
                  testID={`group-color-${color}`}
                  onPress={() => {
                    selectionHaptic();
                    setSelectedColor(color);
                  }}
                  style={[
                    tw("h-10 w-10 rounded-full items-center justify-center"),
                    { backgroundColor: color },
                    selectedColor === color && {
                      borderWidth: 3,
                      borderColor: colors.text,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          {createMutation.isError && (
            <View style={[tw("mt-4 rounded-lg p-3"), { backgroundColor: isDark ? colors["red-900"] : colors["red-100"] }]}>
              <Text style={{ color: colors.danger }}>
                {createMutation.error?.message || "Failed to create group. Please try again."}
              </Text>
            </View>
          )}
        </View>

        <View
          style={[
            tw("px-4 pb-8 pt-4 border-t"),
            { borderColor: colors.border },
          ]}
        >
          <Button
            testID="create-group-submit"
            onPress={handleCreate}
            disabled={!canCreate}
            style={{ width: "100%" }}
          >
            {createMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <ButtonText>Create Group</ButtonText>
            )}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
