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
  ScrollView,
} from "react-native";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { successHaptic, selectionHaptic } from "../lib/haptics";
import { Button, ButtonText } from "@linear-clone/ui-native";
import type { TaskStatus, TaskPriority } from "./TaskRow";
import { tw, colors } from "../lib/styles";

interface CreateTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onTaskCreated: (taskId: string) => void;
}

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "no_priority", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export function CreateTaskModal({
  visible,
  onClose,
  onTaskCreated,
}: CreateTaskModalProps) {
  const { workspaceId, teamId } = useWorkspace();
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("no_priority");
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);

  const { data: projectsData } = trpc.project.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );
  const firstProject = projectsData?.[0]?.project;

  const createMutation = trpc.issue.create.useMutation({
    onSuccess: (data) => {
      successHaptic();
      utils.issue.list.invalidate();
      utils.issue.listByStatus.invalidate();
      setTitle("");
      setStatus("todo");
      setPriority("no_priority");
      onTaskCreated(data.id);
    },
  });

  useEffect(() => {
    if (visible) {
      setTitle("");
      setStatus("todo");
      setPriority("no_priority");
      setShowStatusPicker(false);
      setShowPriorityPicker(false);
    }
  }, [visible]);

  const handleCreate = () => {
    if (!title.trim() || !firstProject) return;
    createMutation.mutate({
      projectId: firstProject.id,
      teamId,
      title: title.trim(),
      status,
      priority,
    });
  };

  const handleClose = () => {
    setTitle("");
    setStatus("todo");
    setPriority("no_priority");
    setShowStatusPicker(false);
    setShowPriorityPicker(false);
    createMutation.reset();
    onClose();
  };

  const canCreate = title.trim().length > 0 && firstProject && !createMutation.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        testID="create-task-modal"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={tw("flex-1 bg-white")}
      >
        <View style={tw("flex-row items-center justify-between border-b border-gray-200 px-4 py-3")}>
          <Pressable testID="create-task-close" onPress={handleClose} style={[tw("p-2"), { marginLeft: -8 }]}>
            <Text style={tw("text-indigo-600 font-medium")}>Cancel</Text>
          </Pressable>
          <Text style={tw("text-lg font-semibold text-gray-900")}>New Task</Text>
          <View style={{ width: 64 }} />
        </View>

        <ScrollView style={tw("flex-1 px-4")}>
          <View style={tw("mt-4")}>
            <TextInput
              testID="create-task-title-input"
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor="#9CA3AF"
              style={tw("text-xl font-medium text-gray-900 py-3")}
              autoFocus
              multiline
              returnKeyType="done"
              blurOnSubmit
            />
          </View>

          {firstProject && (
            <View style={tw("mt-4")}>
              <Text style={tw("text-sm text-gray-500 mb-2")}>Project</Text>
              <View style={tw("flex-row items-center bg-gray-100 rounded-lg px-3 py-3")}>
                <View
                  style={[tw("h-3 w-3 rounded-full mr-2"), { backgroundColor: firstProject.color ?? "#6366F1" }]}
                />
                <Text style={tw("text-gray-900")}>{firstProject.name}</Text>
              </View>
            </View>
          )}

          <View style={tw("mt-4")}>
            <Text style={tw("text-sm text-gray-500 mb-2")}>Status</Text>
            <Pressable
              onPress={() => {
                setShowStatusPicker(!showStatusPicker);
                setShowPriorityPicker(false);
              }}
              style={tw("bg-gray-100 rounded-lg px-3 py-3")}
            >
              <Text style={tw("text-gray-900")}>
                {statusOptions.find((s) => s.value === status)?.label}
              </Text>
            </Pressable>
            {showStatusPicker && (
              <View style={tw("bg-white rounded-lg border border-gray-200 mt-2")}>
                {statusOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      selectionHaptic();
                      setStatus(option.value);
                      setShowStatusPicker(false);
                    }}
                    style={[
                      tw("p-3 border-b border-gray-100"),
                      status === option.value && { backgroundColor: colors["indigo-100"] }
                    ]}
                  >
                    <Text
                      style={
                        status === option.value
                          ? tw("text-indigo-600 font-medium")
                          : tw("text-gray-900")
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={tw("mt-4")}>
            <Text style={tw("text-sm text-gray-500 mb-2")}>Priority</Text>
            <Pressable
              onPress={() => {
                setShowPriorityPicker(!showPriorityPicker);
                setShowStatusPicker(false);
              }}
              style={tw("bg-gray-100 rounded-lg px-3 py-3")}
            >
              <Text style={tw("text-gray-900")}>
                {priorityOptions.find((p) => p.value === priority)?.label}
              </Text>
            </Pressable>
            {showPriorityPicker && (
              <View style={tw("bg-white rounded-lg border border-gray-200 mt-2")}>
                {priorityOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      selectionHaptic();
                      setPriority(option.value);
                      setShowPriorityPicker(false);
                    }}
                    style={[
                      tw("p-3 border-b border-gray-100"),
                      priority === option.value && { backgroundColor: colors["indigo-100"] }
                    ]}
                  >
                    <Text
                      style={
                        priority === option.value
                          ? tw("text-indigo-600 font-medium")
                          : tw("text-gray-900")
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {createMutation.isError && (
            <View style={tw("mt-4 bg-red-50 rounded-lg p-3")}>
              <Text style={tw("text-red-600 text-sm")}>
                Failed to create task. Please try again.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={tw("px-4 pb-8 pt-4 border-t border-gray-200")}>
          <Button
            testID="create-task-submit"
            onPress={handleCreate}
            disabled={!canCreate}
            style={{ width: "100%" }}
          >
            {createMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <ButtonText>Create Task</ButtonText>
            )}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
