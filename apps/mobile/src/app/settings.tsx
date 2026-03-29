import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

const PERMISSIONS = ["read", "write", "delete", "admin"] as const;

function PreferencesSection() {
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery(
    trpc.settings.getPreferences.queryOptions(),
  );

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
    if (!preferences) return;

    if (type === "email") {
      updatePreferences({
        emailNotifications: !preferences.emailNotifications,
      });
    } else {
      updatePreferences({ pushNotifications: !preferences.pushNotifications });
    }
  };

  if (isLoading) {
    return (
      <View className="border-border bg-card rounded-lg border p-4">
        <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
          Preferences
        </Text>
        <Text className="mt-2" style={{ color: colors.muted }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View className="border-border bg-card rounded-lg border p-4">
      <Text className="mb-4 text-lg font-semibold" style={{ color: colors.foreground }}>
        Preferences
      </Text>

      <Text className="mb-2 text-sm font-medium" style={{ color: colors.foreground }}>Theme</Text>
      <View className="mb-4 flex-row gap-2">
        {(["light", "dark", "system"] as const).map((theme) => (
          <Pressable
            key={theme}
            onPress={() => handleThemeChange(theme)}
            className={`rounded-md px-4 py-2 ${
              preferences?.theme === theme
                ? "bg-primary"
                : "border-border bg-background border"
            }`}
          >
            <Text
              style={{
                color:
                  preferences?.theme === theme
                    ? colors.primaryForeground
                    : colors.foreground,
              }}
            >
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="mb-2 text-sm font-medium" style={{ color: colors.foreground }}>
        Notifications
      </Text>
      <View className="gap-2">
        <Pressable
          onPress={() => toggleNotification("email")}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 rounded border ${
              preferences?.emailNotifications
                ? "border-primary bg-primary"
                : "border-border bg-background"
            }`}
          />
          <Text style={{ color: colors.foreground }}>Email notifications</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleNotification("push")}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 rounded border ${
              preferences?.pushNotifications
                ? "border-primary bg-primary"
                : "border-border bg-background"
            }`}
          />
          <Text style={{ color: colors.foreground }}>Push notifications</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    "read",
  ]);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: apiKeys, isLoading } = useQuery(
    trpc.settings.listApiKeys.queryOptions(),
  );

  const { mutate: createKey, isPending: isCreating } = useMutation(
    trpc.settings.createApiKey.mutationOptions({
      onSuccess: (data) => {
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
        <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>API Keys</Text>
        {!showCreateForm && (
          <Pressable
            onPress={() => setShowCreateForm(true)}
            className="bg-primary rounded-md px-3 py-1"
          >
            <Text style={{ color: colors.primaryForeground }}>New Key</Text>
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
            <Text className="font-mono text-xs" style={{ color: colors.foreground }}>{newKey}</Text>
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
          <Text className="mb-2 font-medium" style={{ color: colors.foreground }}>
            Create New API Key
          </Text>

          <TextInput
            value={newKeyName}
            onChangeText={setNewKeyName}
            placeholder="Key name"
            className="border-border bg-background mb-3 rounded-md border px-3 py-2"
            style={{ color: colors.foreground }}
            placeholderTextColor="#888"
          />

          <Text className="mb-2 text-sm" style={{ color: colors.foreground }}>Permissions</Text>
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
                <Text className="capitalize" style={{ color: colors.foreground }}>{permission}</Text>
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
              <Text style={{ color: colors.primaryForeground }}>Create</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowCreateForm(false);
                setNewKeyName("");
                setSelectedPermissions(["read"]);
              }}
              className="border-border rounded-md border px-4 py-2"
            >
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {isLoading ? (
        <Text style={{ color: colors.muted }}>Loading...</Text>
      ) : apiKeys?.length === 0 ? (
        <Text style={{ color: colors.muted }}>No API keys created yet.</Text>
      ) : (
        <View className="gap-2">
          {apiKeys?.map((key) => (
            <View
              key={key.id}
              className="border-border flex-row items-center justify-between rounded-lg border p-3"
            >
              <View className="flex-1">
                <Text className="font-medium" style={{ color: colors.foreground }}>{key.name}</Text>
                <Text className="text-xs" style={{ color: colors.muted }}>
                  {key.keyPrefix}... |{" "}
                  {(key.permissions as string[]).join(", ")}
                </Text>
                {key.lastUsedAt && (
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => handleRevokeKey(key.id, key.name)}
                disabled={isRevoking}
                className="bg-destructive rounded-md px-3 py-1"
              >
                <Text style={{ color: colors.danger }}>Revoke</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Settings" }} />
      <ScrollView className="flex-1 p-4">
        <Text className="mb-4 text-2xl font-bold" style={{ color: colors.foreground }}>
          Settings
        </Text>
        <PreferencesSection />
        <ApiKeysSection />
      </ScrollView>
    </SafeAreaView>
  );
}
