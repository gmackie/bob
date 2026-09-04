import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { overridesFromRows } from "@bob/notifications/preferences-rows";

import { summariseNotificationPreferences } from "~/features/settings/notification-matrix-model";
import { buildSettingsIndex } from "~/features/settings/settings-index-model";
import { SETTINGS_SECTIONS } from "~/features/settings/settings-shell-model";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

/**
 * Settings index — the phone's entry point.
 *
 * Settings was one 742-line scroll of six inline sections; per-type
 * notifications add roughly eighteen more controls, and a flat list stops
 * being navigable well before that. This is the phone half of the job: review
 * on the road, one thing at a time. The tablet renders the same sections
 * beside a rail instead (TabletSettingsPane).
 *
 * Each row shows its current value. An index whose rows only name a
 * destination makes you open all six to learn anything.
 */
export default function SettingsIndexScreen() {
  const { width } = useWindowDimensions();

  const { data: preferences } = useQuery(
    trpc.settings.getPreferences.queryOptions(undefined),
  );
  const { data: notificationRows } = useQuery(
    trpc.settings.listNotificationPreferences.queryOptions(undefined),
  );
  const { data: apiKeys } = useQuery(trpc.settings.listApiKeys.queryOptions(undefined));
  const { data: workspaces } = useQuery(trpc.workspace.list.queryOptions(undefined));

  const prefs = preferences as
    | { pushNotifications?: boolean; emailNotifications?: boolean; theme?: string }
    | undefined;

  const rows = buildSettingsIndex({
    workspaceName:
      (workspaces as { workspace?: { name?: string } }[] | undefined)?.[0]?.workspace?.name ??
      "None selected",
    notificationSummary: summariseNotificationPreferences({
      masters: {
        push: prefs?.pushNotifications ?? true,
        email: prefs?.emailNotifications ?? true,
      },
      overrides: overridesFromRows(
        (notificationRows ?? []) as { type: string; channel: string; enabled: boolean }[],
      ),
    }),
    // Provider health is a node concern; the count here is only a pointer
    // into the Providers screen, which reports the real state.
    providerReadyCount: 0,
    providerTotalCount: 0,
    apiKeyCount: (apiKeys as unknown[] | undefined)?.length ?? 0,
    theme: (prefs?.theme as "light" | "dark" | "system" | undefined) ?? "system",
  }).filter((row) => row.key !== "providers" || SETTINGS_SECTIONS.length > 0);

  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <View className="border-border bg-card overflow-hidden rounded-lg border">
          {rows.map((row, index) => (
            <Pressable
              key={row.key}
              onPress={() => router.push(row.href as never)}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}${row.value ? `, ${row.value}` : ""}`}
              className={`flex-row items-center px-4 py-3 active:opacity-70 ${
                index > 0 ? "border-border border-t" : ""
              }`}
            >
              <Text className="text-foreground flex-1 text-base">{row.label}</Text>
              {row.value ? (
                <Text
                  className={`mr-2 text-sm ${
                    row.needsAttention ? "text-amber-600 dark:text-amber-400" : "text-muted"
                  }`}
                  numberOfLines={1}
                >
                  {row.value}
                </Text>
              ) : null}
              <Text className="text-muted text-base">›</Text>
            </Pressable>
          ))}
        </View>

        {/* On a wide window the phone stack is the wrong shape, but Split View
            can hand an iPad a narrow one — so the hint is width-driven, not
            device-driven. */}
        {width >= 700 ? (
          <Text className="text-muted mt-3 text-xs leading-5">
            Widen the window for the side-by-side settings layout.
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
