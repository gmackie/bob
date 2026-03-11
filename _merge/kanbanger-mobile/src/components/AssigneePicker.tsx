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
import {
  Avatar,
  AvatarFallback,
  AvatarFallbackText,
  AvatarImage,
} from "@linear-clone/ui-native";
import { tw, colors } from "../lib/styles";

interface User {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

interface AssigneePickerProps {
  visible: boolean;
  currentAssigneeId: string | null;
  onSelect: (userId: string | null) => void;
  onClose: () => void;
}

export function AssigneePicker({
  visible,
  currentAssigneeId,
  onSelect,
  onClose,
}: AssigneePickerProps) {
  const { teamId } = useWorkspace();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: members, isLoading } = trpc.user.listByTeam.useQuery(
    { teamId },
    { enabled: visible && !!teamId }
  );

  const filteredMembers = members?.filter((member) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      member.name?.toLowerCase().includes(query) ||
      member.email.toLowerCase().includes(query)
    );
  });

  const handleSelect = (userId: string | null) => {
    onSelect(userId);
    setSearchQuery("");
    onClose();
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email.charAt(0).toUpperCase();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={tw("flex-1 bg-white")}>
        <View style={tw("flex-row items-center justify-between border-b border-gray-200 px-4 py-3")}>
          <Pressable onPress={onClose}>
            <Text style={tw("text-gray-500")}>Cancel</Text>
          </Pressable>
          <Text style={tw("font-semibold text-gray-900")}>Assign to</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={tw("px-4 py-3 border-b border-gray-100")}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search team members..."
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
            <Pressable
              onPress={() => handleSelect(null)}
              style={[
                tw("flex-row items-center px-4 py-3 border-b border-gray-100"),
                currentAssigneeId === null && { backgroundColor: colors["indigo-100"] }
              ]}
            >
              <View style={tw("h-10 w-10 rounded-full bg-gray-200 items-center justify-center mr-3")}>
                <Text style={tw("text-gray-500 text-sm")}>—</Text>
              </View>
              <View style={tw("flex-1")}>
                <Text
                  style={
                    currentAssigneeId === null
                      ? tw("text-indigo-600 font-medium")
                      : tw("text-gray-900")
                  }
                >
                  Unassigned
                </Text>
              </View>
              {currentAssigneeId === null && (
                <Text style={tw("text-indigo-600")}>✓</Text>
              )}
            </Pressable>

            {filteredMembers?.map((member) => (
              <Pressable
                key={member.id}
                onPress={() => handleSelect(member.id)}
                style={[
                  tw("flex-row items-center px-4 py-3 border-b border-gray-100"),
                  currentAssigneeId === member.id && { backgroundColor: colors["indigo-100"] }
                ]}
              >
                <Avatar style={{ height: 40, width: 40, marginRight: 12 }}>
                  {member.avatarUrl ? (
                    <AvatarImage src={member.avatarUrl} />
                  ) : null}
                  <AvatarFallback style={{ backgroundColor: colors["indigo-100"] }}>
                    <AvatarFallbackText style={{ color: colors["indigo-600"], fontSize: 14 }}>
                      {getInitials(member.name, member.email)}
                    </AvatarFallbackText>
                  </AvatarFallback>
                </Avatar>
                <View style={tw("flex-1")}>
                  <Text
                    style={
                      currentAssigneeId === member.id
                        ? tw("text-indigo-600 font-medium")
                        : tw("text-gray-900")
                    }
                  >
                    {member.name ?? member.email}
                  </Text>
                  {member.name && (
                    <Text style={tw("text-gray-500 text-sm")}>{member.email}</Text>
                  )}
                </View>
                {currentAssigneeId === member.id && (
                  <Text style={tw("text-indigo-600")}>✓</Text>
                )}
              </Pressable>
            ))}

            {filteredMembers?.length === 0 && (
              <View style={tw("items-center py-8")}>
                <Text style={tw("text-gray-400")}>No team members found</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
