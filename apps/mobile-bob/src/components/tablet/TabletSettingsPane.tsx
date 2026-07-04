import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams, usePathname } from "expo-router";

import {
  buildMobileSettingsActions,
  buildWorkspaceSettingRows,
} from "~/features/settings/settings-model";
import type {
  MobileSettingsSectionKey,
  WorkspaceSettingMembership,
} from "~/features/settings/settings-model";
import {
  buildWorkspaceSelectionPath,
  SELECTED_WORKSPACE_KEY,
} from "~/features/settings/workspace-selection";
import type { ProviderKey } from "~/features/tablet/dashboard";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

interface TabletSettingsPaneProps {
  onOpenProvider?: (provider: ProviderKey) => void;
}

export function TabletSettingsPane({ onOpenProvider }: TabletSettingsPaneProps) {
  const queryClient = useQueryClient();
  const pathname = usePathname() ?? "/settings";
  const searchParams = useLocalSearchParams();
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<MobileSettingsSectionKey, number>>({
    workspace: 0,
    account: 0,
    providers: 0,
    app: 0,
    device: 0,
  });
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const { data: memberships, isLoading } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const preferencesQuery = useQuery(
    trpc.settings.getPreferences.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const apiKeysQuery = useQuery(
    trpc.settings.listApiKeys.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const updatePreferences = useMutation(
    trpc.settings.updatePreferences.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.getPreferences.queryFilter(),
        );
      },
    }),
  );

  useEffect(() => {
    void AsyncStorage.getItem(SELECTED_WORKSPACE_KEY)
      .then(setSelectedWorkspaceId)
      .catch(() => setSelectedWorkspaceId(null));
  }, []);

  const workspaceRows = useMemo(
    () =>
      buildWorkspaceSettingRows({
        selectedWorkspaceId,
        memberships: (memberships ?? []),
      }),
    [memberships, selectedWorkspaceId],
  );
  const actions = buildMobileSettingsActions();
  const preferences = preferencesQuery.data as
    | {
        theme?: "light" | "dark" | "system";
        emailNotifications?: boolean;
        pushNotifications?: boolean;
      }
    | undefined;
  const apiKeyCount = Array.isArray(apiKeysQuery.data) ? apiKeysQuery.data.length : 0;

  const selectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId);
    void AsyncStorage.setItem(SELECTED_WORKSPACE_KEY, workspaceId).then(() => {
      void queryClient.invalidateQueries({ queryKey: trpc.workspace.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.workItem.list.queryKey() });
      router.replace(
        buildWorkspaceSelectionPath(
          currentPath(pathname, searchParams),
          workspaceId,
        ) as Parameters<typeof router.replace>[0],
      );
    });
  };

  const scrollToSection = (section: MobileSettingsSectionKey) => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, sectionOffsets.current[section] - 16),
      animated: true,
    });
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Sign out of Bob on this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          void AsyncStorage.removeItem(SELECTED_WORKSPACE_KEY)
            .then(() => authClient.signOut())
            .finally(() => {
              queryClient.clear();
              router.replace("/");
            });
        },
      },
    ]);
  };

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
      style={{ backgroundColor: colors.background }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            Settings
          </Text>
          <Text className="mt-1 text-sm text-muted" numberOfLines={1}>
            Workspace, account, providers, app, and device controls
          </Text>
        </View>
      </View>

      <View className="mt-6 flex-row flex-wrap gap-3">
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={
              action.kind === "logout"
                ? handleLogout
                : action.targetSection
                  ? () => scrollToSection(action.targetSection!)
                  : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={action.label}
            className="rounded-lg border p-4 active:opacity-80"
            style={{
              borderColor: colors.border,
              backgroundColor: action.kind === "logout" ? colors.danger + "12" : colors.card,
              flexBasis: "31%",
              flexGrow: 1,
              minWidth: 180,
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: action.kind === "logout" ? colors.danger : colors.foreground }}
            >
              {action.label}
            </Text>
            <Text className="mt-2 text-xs leading-5 text-muted">
              {action.description}
            </Text>
          </Pressable>
        ))}
      </View>

      <View
        className="mt-6 rounded-lg border p-4"
        onLayout={(event) => {
          sectionOffsets.current.workspace = event.nativeEvent.layout.y;
        }}
        style={{ borderColor: colors.border, backgroundColor: colors.card }}
      >
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Workspace
        </Text>
        {isLoading ? (
          <Text className="mt-3 text-sm text-muted">Loading workspaces...</Text>
        ) : workspaceRows.length === 0 ? (
          <Text className="mt-3 text-sm text-muted">No workspaces available.</Text>
        ) : (
          <View className="mt-3 gap-2">
            {workspaceRows.map((workspace) => (
              <Pressable
                key={workspace.id}
                onPress={() => selectWorkspace(workspace.id)}
                accessibilityRole="button"
                accessibilityLabel={`Use workspace ${workspace.name}`}
                className="flex-row items-center justify-between rounded-lg border px-3 py-3 active:opacity-80"
                style={{
                  borderColor: colors.border,
                  backgroundColor: workspace.isSelected
                    ? colors.primary + "22"
                    : colors.background,
                }}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {workspace.name}
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
                    {workspace.slug}
                  </Text>
                </View>
                <Text
                  className="ml-3 text-xs font-semibold"
                  style={{ color: workspace.isSelected ? colors.primary : colors.muted }}
                >
                  {workspace.isSelected ? "Current" : "Use"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View
        className="mt-4 rounded-lg border p-4"
        onLayout={(event) => {
          sectionOffsets.current.account = event.nativeEvent.layout.y;
        }}
        style={{ borderColor: colors.border, backgroundColor: colors.card }}
      >
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Account
        </Text>
        <Text className="mt-3 text-sm text-foreground">
          Active signed-in session
        </Text>
        <Text className="mt-1 text-xs text-muted">
          Manage the current account session on this device.
        </Text>
        <Pressable
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
          className="mt-3 self-start rounded-md border px-3 py-2 active:opacity-80"
          style={{ borderColor: colors.danger + "66" }}
        >
          <Text className="text-xs font-semibold" style={{ color: colors.danger }}>
            Log out
          </Text>
        </Pressable>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-4">
        <View
          className="min-w-72 flex-1 rounded-lg border p-4"
          onLayout={(event) => {
            sectionOffsets.current.providers = event.nativeEvent.layout.y;
          }}
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
            Providers
          </Text>
          <View className="mt-3 flex-row gap-2">
            {(["codex", "cursor"] as const).map((provider) => (
              <Pressable
                key={provider}
                onPress={() => onOpenProvider?.(provider)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${provider} provider detail`}
                className="flex-1 rounded-md px-3 py-2 active:opacity-80"
                style={{ backgroundColor: colors.secondary }}
              >
                <Text className="text-center text-xs font-semibold text-foreground">
                  {provider === "codex" ? "Codex" : "Cursor"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View
          className="min-w-72 flex-1 rounded-lg border p-4"
          onLayout={(event) => {
            sectionOffsets.current.app = event.nativeEvent.layout.y;
          }}
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
            App
          </Text>
          <Text className="mt-3 text-sm text-foreground">
            Theme: {preferences?.theme ?? "system"}
          </Text>
          <Text className="mt-1 text-xs text-muted">
            Email {preferences?.emailNotifications ? "on" : "off"} · Push {preferences?.pushNotifications ? "on" : "off"}
          </Text>
          <View className="mt-3 flex-row gap-2">
            {(["light", "dark", "system"] as const).map((theme) => (
              <Pressable
                key={theme}
                onPress={() => updatePreferences.mutate({ theme })}
                className="rounded-md px-3 py-2 active:opacity-80"
                style={{
                  backgroundColor: preferences?.theme === theme ? colors.primary : colors.secondary,
                }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{
                    color:
                      preferences?.theme === theme
                        ? colors.primaryForeground
                        : colors.foreground,
                  }}
                >
                  {theme}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View
          className="min-w-72 flex-1 rounded-lg border p-4"
          onLayout={(event) => {
            sectionOffsets.current.device = event.nativeEvent.layout.y;
          }}
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
            Device
          </Text>
          <Text className="mt-3 text-sm text-foreground">
            {apiKeyCount} API key{apiKeyCount === 1 ? "" : "s"} configured
          </Text>
          <Text className="mt-1 text-xs text-muted">
            Device auth is tied to the current signed-in session.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function currentPath(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => search.append(key, entry));
      return;
    }
    if (typeof value === "string") search.set(key, value);
  });

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
