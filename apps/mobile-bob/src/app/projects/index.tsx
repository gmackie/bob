import { Redirect, router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Button, Card, ListRow, Screen } from "~/components/ui";
import { getProjectHref } from "~/features/planning/navigation";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

interface ProjectListEntry {
  project: { id: string; name: string; key: string };
  counts: { active: number; issues: number; tasks: number };
}

function useSelectedWorkspaceId(workspaces: { workspace: { id: string } }[]) {
  const [id, setId] = useMemo(() => {
    let stored: string | null = null;
    AsyncStorage.getItem("@bob/selected_workspace").then((v) => {
      stored = v;
    });
    return [stored, () => {}] as const;
  }, []);

  const ws = workspaces.find((w) => w.workspace.id === id);
  return ws?.workspace.id ?? workspaces[0]?.workspace.id ?? null;
}

export default function ProjectsListScreen() {
  const { data: session, isPending } = authClient.useSession();

  const workspacesQuery = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      enabled: Boolean(session),
    }),
  );

  const workspaces = useMemo(
    () => (workspacesQuery.data as { workspace: { id: string; name: string } }[] | undefined) ?? [],
    [workspacesQuery.data],
  );

  const workspaceId = useSelectedWorkspaceId(workspaces);

  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: workspaceId ?? "" },
      { enabled: Boolean(workspaceId) },
    ),
  );

  const projects = useMemo(
    () => (projectsQuery.data as ProjectListEntry[] | undefined) ?? [],
    [projectsQuery.data],
  );

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  if (projectsQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
        <Text className="mt-3 text-muted">Loading projects…</Text>
      </Screen>
    );
  }

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <View className="mb-5 flex-row items-center justify-between">
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            Projects
          </Text>
          <Button variant="ghost" size="sm" onPress={() => router.back()}>
            Back
          </Button>
        </View>

        <Card className="mb-8">
          {projects.length > 0 ? (
            projects.map((entry, index) => (
              <ListRow
                key={entry.project.id}
                title={`${entry.project.key} · ${entry.project.name}`}
                subtitle={`${entry.counts.tasks} tasks · ${entry.counts.issues} issues · ${entry.counts.active} active`}
                right={<Text className="text-sm text-muted">Open</Text>}
                onPress={() => router.push(getProjectHref(entry.project.id) as never)}
                showDivider={index < projects.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm text-muted">No projects yet.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
