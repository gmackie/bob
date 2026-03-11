import React, { useState } from "react";
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator, Modal, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, BadgeText } from "@linear-clone/ui-native";
import type { ProjectsStackParamList } from "../navigation/types";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { CreateGroupModal } from "../components/CreateGroupModal";

type ProjectsNavigationProp = NativeStackNavigationProp<ProjectsStackParamList, "ProjectsList">;

const statusLabels: Record<string, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In Progress",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

interface ProjectsScreenProps {
  onProjectPress?: (projectId: string) => void;
}

export function ProjectsScreen({ onProjectPress }: ProjectsScreenProps) {
  const navigation = useNavigation<ProjectsNavigationProp>();
  const { workspaceId } = useWorkspace();
  const { colors, isDark } = useTheme();

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const handleProjectPress = (projectId: string) => {
    if (onProjectPress) {
      onProjectPress(projectId);
    } else {
      navigation.navigate("ProjectDetail", { projectId });
    }
  };
  const { data: projects, isLoading, refetch, isRefetching } = trpc.project.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      backlog: isDark ? colors["gray-700"] : colors["gray-400"],
      planned: isDark ? colors["gray-600"] : colors["gray-500"],
      in_progress: isDark ? colors["blue-600"] : colors["blue-500"],
      paused: isDark ? colors["yellow-600"] : colors["yellow-500"],
      completed: isDark ? colors["green-600"] : colors["green-500"],
      canceled: isDark ? colors["red-600"] : colors["red-500"],
    };
    return map[status] ?? colors["gray-500"];
  };

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]} testID="projects-screen">
      <View style={[tw("border-b px-4 py-3 flex-row items-center justify-between"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text testID="projects-header" style={[tw("text-xl font-bold"), { color: colors.text }]}>Projects</Text>
        <Pressable
          testID="add-button"
          onPress={() => setShowMenu(true)}
          style={[tw("h-8 w-8 items-center justify-center rounded-md"), { backgroundColor: colors.primary }]}
        >
          <Ionicons name="add" size={20} color={colors.white} />
        </Pressable>
      </View>

      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable
          style={tw("flex-1")}
          onPress={() => setShowMenu(false)}
        >
          <View style={[tw("absolute right-4 top-14 rounded-lg shadow-lg overflow-hidden"), { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 180 }]}>
            <TouchableOpacity
              testID="menu-new-project"
              style={[tw("flex-row items-center px-4 py-3 gap-3"), { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              onPress={() => {
                setShowMenu(false);
                setShowCreateProject(true);
              }}
            >
              <Ionicons name="folder-outline" size={20} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 16 }}>New Project</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="menu-new-group"
              style={tw("flex-row items-center px-4 py-3 gap-3")}
              onPress={() => {
                setShowMenu(false);
                setShowCreateGroup(true);
              }}
            >
              <Ionicons name="albums-outline" size={20} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 16 }}>New Group</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {isLoading ? (
        <View testID="projects-loading" style={tw("flex-1 items-center justify-center")}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          testID="projects-list"
          style={tw("flex-1")}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          {projects && projects.length > 0 ? (
            projects.map((p) => (
              <Pressable
                key={p.project.id}
                testID={`project-card-${p.project.id}`}
                accessibilityLabel={`Project ${p.project.name}`}
                onPress={() => handleProjectPress(p.project.id)}
              >
                <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                  <CardHeader style={{ paddingBottom: 8 }}>
                    <View style={tw("flex-row items-center justify-between")}>
                      <View style={tw("flex-row items-center gap-3")}>
                        <View
                          style={[
                            tw("h-8 w-8 rounded-lg items-center justify-center"),
                            { backgroundColor: `${p.project.color ?? "#6366f1"}20` }
                          ]}
                        >
                          <Text style={{ color: p.project.color ?? "#6366f1", fontWeight: "bold" }}>
                            {p.project.name.charAt(0)}
                          </Text>
                        </View>
                        <View>
                          <CardTitle style={{ fontSize: 16, color: colors.text }}>{p.project.name}</CardTitle>
                        </View>
                      </View>
                      <Badge style={{ backgroundColor: getStatusColor(p.project.status), paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                        <BadgeText style={{ fontSize: 12, color: colors.white }}>
                          {statusLabels[p.project.status] ?? p.project.status}
                        </BadgeText>
                      </Badge>
                    </View>
                  </CardHeader>
                  <CardContent>
                    {p.project.description && (
                      <CardDescription numberOfLines={2} style={{ marginBottom: 12, color: colors.textSecondary }}>
                        {p.project.description}
                      </CardDescription>
                    )}
                    <View style={tw("flex-row items-center justify-between")}>
                      <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                        {p.completedCount ?? 0} / {p.issueCount ?? 0} issues
                      </Text>
                      {p.teams && p.teams.length > 0 && (
                        <View style={tw("flex-row gap-1")}>
                          {p.teams.slice(0, 2).map((team) => (
                            <Badge key={team.id} style={{ backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"], paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                              <BadgeText style={{ fontSize: 12, color: colors.textSecondary }}>{team.name}</BadgeText>
                            </Badge>
                          ))}
                        </View>
                      )}
                    </View>
                    {(p.issueCount ?? 0) > 0 && (
                      <View style={[tw("mt-3 rounded-full overflow-hidden"), { height: 6, backgroundColor: isDark ? colors["gray-700"] : colors["gray-200"] }]}>
                        <View
                          style={[
                            tw("h-full rounded-full"),
                            { width: `${Math.round(((p.completedCount ?? 0) / (p.issueCount ?? 1)) * 100)}%`, backgroundColor: p.project.color ?? colors.primary }
                          ]}
                        />
                      </View>
                    )}
                  </CardContent>
                </Card>
              </Pressable>
            ))
          ) : (
            <View testID="projects-empty" style={tw("items-center justify-center py-16")}>
              <Text style={[tw("text-base"), { color: colors.textSecondary }]}>No projects yet</Text>
              <Text style={[tw("text-sm mt-1"), { color: colors.textTertiary }]}>
                Tap the + button above to create one
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <CreateProjectModal
        visible={showCreateProject}
        onClose={() => setShowCreateProject(false)}
        onProjectCreated={(projectId) => {
          setShowCreateProject(false);
          handleProjectPress(projectId);
        }}
      />

      <CreateGroupModal
        visible={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onGroupCreated={() => {
          setShowCreateGroup(false);
        }}
      />
    </View>
  );
}
