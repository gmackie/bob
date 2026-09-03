/**
 * The settings sections, as components both shells render.
 *
 * The phone pushes each of these onto a stack (review on the road: one thing
 * at a time). The tablet shows them in the detail half of a master-detail
 * layout (working sessions: list and detail together). Extracting them here
 * means the two surfaces cannot drift into having different settings — which
 * is what happens when a 742-line screen is copied rather than shared.
 *
 * Extracted verbatim from app/settings.tsx; behaviour is unchanged.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { router, Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  MobileSettingsAction,
  MobileSettingsSectionKey,
} from "~/features/settings/settings-model";
import {
  buildMobileSettingsActions,
  buildMobileSettingsDeviceSummary,
  buildMobileSettingsProviderRows,
  buildWorkspaceSettingRows,
} from "~/features/settings/settings-model";
import { SELECTED_WORKSPACE_KEY } from "~/features/settings/workspace-selection";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import type { ProviderKey } from "~/features/tablet/dashboard";

const PERMISSIONS = ["read", "write", "delete", "admin"] as const;

interface PreferencesData {
  theme: "light" | "dark" | "system";
  emailNotifications: boolean;
  pushNotifications: boolean;
}

interface ApiKeyData {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  lastUsedAt: string | Date | null;
}

interface CreatedApiKeyData {
  key: string;
}

function SettingsActionGrid({
  actions,
  onActionPress,
}: {
  actions: MobileSettingsAction[];
  onActionPress: (action: MobileSettingsAction) => void;
}) {
  return (
    <View className="mb-4 flex-row flex-wrap gap-3">
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => onActionPress(action)}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          className="border-border rounded-lg border p-3 active:opacity-80"
          style={{
            backgroundColor:
              action.kind === "logout" ? colors.danger + "12" : colors.card,
            flexBasis: "48%",
            flexGrow: 1,
            minWidth: 150,
          }}
        >
          <Text
            className="text-sm font-semibold"
            style={{
              color:
                action.kind === "logout" ? colors.danger : colors.foreground,
            }}
          >
            {action.label}
          </Text>
          <Text className="text-muted mt-2 text-xs leading-5">
            {action.description}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AccountSection() {
  const queryClient = useQueryClient();

  const clearLocalSession = () => {
    queryClient.clear();
    router.replace("/");
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
            .finally(clearLocalSession);
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "Permanently delete your Bob account and sign out on this device?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const result = await authClient.deleteUser({});
                if (result.error) {
                  throw new Error(
                    result.error.message ?? "Account deletion failed",
                  );
                }
                await AsyncStorage.removeItem(SELECTED_WORKSPACE_KEY);
                await authClient.signOut().catch(() => undefined);
                clearLocalSession();
              } catch {
                Alert.alert(
                  "Account not deleted",
                  "Bob could not delete your account. Please try again.",
                );
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View className="border-border bg-card mt-4 rounded-lg border p-4">
      <Text className="text-foreground text-lg font-semibold">Account</Text>
      <Text className="text-muted mt-2 text-sm">
        Manage the active session on this device.
      </Text>
      <View className="mt-4 flex-row flex-wrap gap-3">
        <Pressable
          onPress={handleLogout}
          className="border-danger/40 self-start rounded-md border px-4 py-2"
        >
          <Text className="text-danger font-medium">Log out</Text>
        </Pressable>
        <Pressable
          testID="settings-delete-account"
          onPress={handleDeleteAccount}
          accessibilityRole="button"
          accessibilityLabel="Delete Account"
          className="self-start rounded-md px-4 py-2"
          style={{ backgroundColor: colors.danger }}
        >
          <Text className="text-background font-medium">Delete Account</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function WorkspacesSection() {
  const queryClient = useQueryClient();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const { data: memberships, isLoading } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  useEffect(() => {
    void AsyncStorage.getItem(SELECTED_WORKSPACE_KEY)
      .then(setSelectedWorkspaceId)
      .catch(() => setSelectedWorkspaceId(null));
  }, []);

  const rows = useMemo(
    () =>
      buildWorkspaceSettingRows({
        selectedWorkspaceId,
        memberships: memberships ?? [],
      }),
    [memberships, selectedWorkspaceId],
  );

  const selectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId);
    void AsyncStorage.setItem(SELECTED_WORKSPACE_KEY, workspaceId).then(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.workspace.list.queryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.project.list.queryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.workItem.list.queryKey(),
      });
    });
  };

  return (
    <View className="border-border bg-card rounded-lg border p-4">
      <Text className="text-foreground text-lg font-semibold">Workspace</Text>
      <Text className="text-muted mt-2 text-sm">
        Choose the workspace used by the dashboard, planning, and project views.
      </Text>

      {isLoading ? (
        <Text className="text-muted mt-4">Loading workspaces...</Text>
      ) : rows.length === 0 ? (
        <Text className="text-muted mt-4">No workspaces available.</Text>
      ) : (
        <View className="mt-4 gap-2">
          {rows.map((workspace) => (
            <Pressable
              key={workspace.id}
              onPress={() => selectWorkspace(workspace.id)}
              className="border-border flex-row items-center justify-between rounded-lg border p-3"
              style={{
                backgroundColor: workspace.isSelected
                  ? colors.primary + "20"
                  : colors.background,
              }}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-foreground font-medium" numberOfLines={1}>
                  {workspace.name}
                </Text>
                <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
                  {workspace.slug}
                </Text>
              </View>
              <Text
                className="ml-3 text-xs font-semibold"
                style={{
                  color: workspace.isSelected ? colors.primary : colors.muted,
                }}
              >
                {workspace.isSelected ? "Current" : "Use"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function ProvidersSection({
  onOpenProvider,
}: {
  /** Tablet passes this so provider detail opens in the cockpit pane instead
   *  of pushing a route the split layout has no stack for. */
  onOpenProvider?: (provider: ProviderKey) => void;
} = {}) {
  const rows = buildMobileSettingsProviderRows();

  return (
    <View className="border-border bg-card mt-4 rounded-lg border p-4">
      <Text className="text-foreground text-lg font-semibold">Providers</Text>
      <Text className="text-muted mt-2 text-sm">
        Review Codex and Cursor capacity, limits, active sessions, and outcomes.
      </Text>
      <View className="mt-4 gap-2">
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={() =>
              onOpenProvider ? onOpenProvider(row.key as ProviderKey) : router.push(row.href)
            }
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.label} provider settings`}
            className="border-border rounded-lg border p-3 active:opacity-80"
            style={{ backgroundColor: colors.background }}
          >
            <Text className="text-foreground text-sm font-semibold">
              {row.label}
            </Text>
            <Text className="text-muted mt-1 text-xs leading-5">
              {row.description}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function PreferencesSection() {
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery(
    trpc.settings.getPreferences.queryOptions(undefined),
  );
  const currentPreferences = preferences as PreferencesData | undefined;

  const { mutate: updatePreferences } = useMutation(
    trpc.settings.updatePreferences.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.getPreferences.queryFilter(),
        );
      },
    }),
  );

  const handleThemeChange = (theme: "light" | "dark" | "system") => {
    updatePreferences({ theme });
  };

  const toggleNotification = (type: "email" | "push") => {
    if (!currentPreferences) return;

    if (type === "email") {
      updatePreferences({
        emailNotifications: !currentPreferences.emailNotifications,
      });
    } else {
      updatePreferences({
        pushNotifications: !currentPreferences.pushNotifications,
      });
    }
  };

  if (isLoading) {
    return (
      <View className="border-border bg-card rounded-lg border p-4">
        <Text className="text-foreground text-lg font-semibold">
          Preferences
        </Text>
        <Text className="text-muted mt-2">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="border-border bg-card rounded-lg border p-4">
      <Text className="text-foreground mb-4 text-lg font-semibold">
        Preferences
      </Text>

      <Text className="text-foreground mb-2 text-sm font-medium">Theme</Text>
      <View className="mb-4 flex-row gap-2">
        {(["light", "dark", "system"] as const).map((theme) => (
          <Pressable
            key={theme}
            onPress={() => handleThemeChange(theme)}
            className={`rounded-md px-4 py-2 ${
              currentPreferences?.theme === theme
                ? "bg-primary"
                : "border-border bg-background border"
            }`}
          >
            <Text
              style={{
                color:
                  currentPreferences?.theme === theme
                    ? colors.primaryForeground
                    : colors.foreground,
              }}
            >
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-foreground mb-2 text-sm font-medium">
        Notifications
      </Text>
      <View className="gap-2">
        <Pressable
          onPress={() => toggleNotification("email")}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 rounded border ${
              currentPreferences?.emailNotifications
                ? "border-primary bg-primary"
                : "border-border bg-background"
            }`}
          />
          <Text className="text-foreground">Email notifications</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleNotification("push")}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 rounded border ${
              currentPreferences?.pushNotifications
                ? "border-primary bg-primary"
                : "border-border bg-background"
            }`}
          />
          <Text className="text-foreground">Push notifications</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function DeviceSection() {
  const { data: apiKeys } = useQuery(
    trpc.settings.listApiKeys.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const apiKeyCount = Array.isArray(apiKeys) ? apiKeys.length : 0;
  const summary = buildMobileSettingsDeviceSummary({ apiKeyCount });

  return (
    <View className="border-border bg-card mt-4 rounded-lg border p-4">
      <Text className="text-foreground text-lg font-semibold">
        {summary.title}
      </Text>
      <Text className="text-foreground mt-3 text-sm">
        {summary.primaryLabel}
      </Text>
      <Text className="text-muted mt-1 text-sm">{summary.detailLabel}</Text>
    </View>
  );
}

export function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    "read",
  ]);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: apiKeys, isLoading } = useQuery(
    trpc.settings.listApiKeys.queryOptions(undefined),
  );
  const apiKeyRows = (apiKeys ?? []) as ApiKeyData[];

  const { mutate: createKey, isPending: isCreating } = useMutation(
    trpc.settings.createApiKey.mutationOptions({
      onSuccess: (data: CreatedApiKeyData) => {
        setNewKey(data.key);
        setNewKeyName("");
        setSelectedPermissions(["read"]);
        setShowCreateForm(false);
        void queryClient.invalidateQueries(
          trpc.settings.listApiKeys.queryFilter(),
        );
      },
    }),
  );

  const { mutate: revokeKey, isPending: isRevoking } = useMutation(
    trpc.settings.revokeApiKey.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.listApiKeys.queryFilter(),
        );
      },
    }),
  );

  const handleCreateKey = () => {
    if (!newKeyName.trim() || selectedPermissions.length === 0) return;
    createKey({
      name: newKeyName,
      permissions: selectedPermissions as (
        | "read"
        | "write"
        | "delete"
        | "admin"
      )[],
    });
  };

  const handleRevokeKey = (id: string, name: string) => {
    Alert.alert(
      "Revoke API Key",
      `Are you sure you want to revoke "${name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revokeKey({ id }),
        },
      ],
    );
  };

  const togglePermission = (permission: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission],
    );
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "API key copied to clipboard");
  };

  return (
    <View className="border-border bg-card mt-4 rounded-lg border p-4">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-foreground text-lg font-semibold">API Keys</Text>
        {!showCreateForm && (
          <Pressable
            onPress={() => setShowCreateForm(true)}
            className="bg-primary rounded-md px-3 py-1"
          >
            <Text className="text-primary-foreground">New Key</Text>
          </Pressable>
        )}
      </View>

      {newKey && (
        <View className="mb-4 rounded-lg border border-green-500 bg-green-50 p-3 dark:bg-green-950">
          <Text className="mb-1 font-medium text-green-800 dark:text-green-200">
            API Key Created
          </Text>
          <Text className="mb-2 text-xs text-green-700 dark:text-green-300">
            Copy now. You won&apos;t see this again.
          </Text>
          <Pressable
            onPress={() => void copyToClipboard(newKey)}
            className="rounded bg-white p-2 dark:bg-gray-900"
          >
            <Text className="text-foreground font-mono text-xs">{newKey}</Text>
          </Pressable>
          <Pressable onPress={() => setNewKey(null)} className="mt-2">
            <Text className="text-sm text-green-700 dark:text-green-300">
              Dismiss
            </Text>
          </Pressable>
        </View>
      )}

      {showCreateForm && (
        <View className="border-border mb-4 rounded-lg border p-3">
          <Text className="text-foreground mb-2 font-medium">
            Create New API Key
          </Text>

          <TextInput
            value={newKeyName}
            onChangeText={setNewKeyName}
            placeholder="Key name"
            className="border-border bg-background text-foreground mb-3 rounded-md border px-3 py-2"
            placeholderTextColor="#888"
          />

          <Text className="text-foreground mb-2 text-sm">Permissions</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {PERMISSIONS.map((permission) => (
              <Pressable
                key={permission}
                onPress={() => togglePermission(permission)}
                className="flex-row items-center gap-1"
              >
                <View
                  className={`h-4 w-4 rounded border ${
                    selectedPermissions.includes(permission)
                      ? "border-primary bg-primary"
                      : "border-border bg-background"
                  }`}
                />
                <Text className="text-foreground capitalize">{permission}</Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-row gap-2">
            <Pressable
              onPress={handleCreateKey}
              disabled={
                isCreating ||
                !newKeyName.trim() ||
                selectedPermissions.length === 0
              }
              className="bg-primary rounded-md px-4 py-2"
            >
              <Text className="text-primary-foreground">Create</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowCreateForm(false);
                setNewKeyName("");
                setSelectedPermissions(["read"]);
              }}
              className="border-border rounded-md border px-4 py-2"
            >
              <Text className="text-foreground">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {isLoading ? (
        <Text className="text-muted">Loading...</Text>
      ) : apiKeyRows.length === 0 ? (
        <Text className="text-muted">No API keys created yet.</Text>
      ) : (
        <View className="gap-2">
          {apiKeyRows.map((key) => (
            <View
              key={key.id}
              className="border-border flex-row items-center justify-between rounded-lg border p-3"
            >
              <View className="flex-1">
                <Text className="text-foreground font-medium">{key.name}</Text>
                <Text className="text-muted text-xs">
                  {key.keyPrefix}... | {key.permissions.join(", ")}
                </Text>
                {key.lastUsedAt && (
                  <Text className="text-muted text-xs">
                    Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => handleRevokeKey(key.id, key.name)}
                disabled={isRevoking}
                className="bg-destructive rounded-md px-3 py-1"
              >
                <Text className="text-danger">Revoke</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
