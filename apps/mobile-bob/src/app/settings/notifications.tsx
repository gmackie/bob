import { useMemo } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { notificationChannels } from "@bob/notifications/preferences";
import type {
  NotificationChannel,
  NotificationType,
} from "@bob/notifications/preferences";
import { overridesFromRows } from "@bob/notifications/preferences-rows";

import {
  CHANNEL_LABELS,
  buildNotificationMatrix,
} from "~/features/settings/notification-matrix-model";
import { trpc } from "~/utils/api";

/**
 * Per-type notification control.
 *
 * Delivery used to be two booleans, so the only choices were every event or
 * silence — and an agent blocked waiting on you arrived in the same stream as
 * "batch completed". Six events × three channels does not fit inline in a
 * settings list, which is why this is its own screen.
 *
 * The rules live in @bob/notifications/preferences, shared with the gateway
 * and the API. Nothing here re-decides them; it only shows them.
 */
export default function NotificationSettingsScreen() {
  const queryClient = useQueryClient();

  const { data: preferences } = useQuery(
    trpc.settings.getPreferences.queryOptions(undefined),
  );
  const { data: rows, isLoading } = useQuery(
    trpc.settings.listNotificationPreferences.queryOptions(undefined),
  );

  const { mutate: setPreference } = useMutation(
    trpc.settings.setNotificationPreference.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.listNotificationPreferences.queryFilter(),
        );
      },
    }),
  );

  const masters = {
    push: (preferences as { pushNotifications?: boolean } | undefined)?.pushNotifications ?? true,
    email:
      (preferences as { emailNotifications?: boolean } | undefined)?.emailNotifications ?? true,
  };

  const matrix = useMemo(
    () =>
      buildNotificationMatrix({
        masters,
        overrides: overridesFromRows(
          (rows ?? []) as { type: string; channel: string; enabled: boolean }[],
        ),
      }),
    [rows, masters.push, masters.email],
  );

  const toggle = (type: NotificationType, channel: NotificationChannel, next: boolean) => {
    setPreference({ type, channel, enabled: next });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <Text className="text-muted text-sm leading-5">
          Push is for when you are the blocker. Everything stays in your in-app
          list either way.
        </Text>

        {/* Column headers, so a row of three bare switches is readable. */}
        <View className="mt-6 flex-row items-end">
          <View className="flex-1" />
          {notificationChannels.map((channel) => (
            <Text
              key={channel}
              className="text-muted w-16 text-center text-[11px] font-medium uppercase"
            >
              {CHANNEL_LABELS[channel]}
            </Text>
          ))}
        </View>

        {isLoading ? (
          <Text className="text-muted mt-6">Loading…</Text>
        ) : (
          <View className="border-border bg-card mt-2 overflow-hidden rounded-lg border">
            {matrix.map((row, index) => (
              <View
                key={row.type}
                className={`flex-row items-center px-3 py-3 ${
                  index > 0 ? "border-border border-t" : ""
                }`}
              >
                <View className="flex-1 pr-2">
                  <Text className="text-foreground text-sm font-medium">{row.label}</Text>
                  <Text className="text-muted mt-0.5 text-xs leading-4">{row.hint}</Text>
                </View>
                {notificationChannels.map((channel) => {
                  const cell = row.channels[channel];
                  return (
                    <View key={channel} className="w-16 items-center">
                      <Switch
                        value={cell.enabled}
                        // A channel whose master switch is off reads as inert,
                        // but the stored choice is preserved and returns when
                        // the channel is switched back on.
                        disabled={cell.disabled}
                        onValueChange={(next) => toggle(row.type, channel, next)}
                        accessibilityLabel={`${row.label}, ${CHANNEL_LABELS[channel]}`}
                      />
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {!masters.push ? (
          <Text className="text-muted mt-3 text-xs leading-5">
            Push is off for this account, so the push column is inactive. Your
            per-event choices are kept and return when you switch it back on.
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
