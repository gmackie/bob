import { useMemo } from "react";
import { Switch, Text, View } from "react-native";
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
 * The notification matrix, tablet form.
 *
 * Same rows and rules as the phone screen — the model is shared, so the two
 * cannot disagree about what a switch means. The tablet has the width to show
 * each event's description on its own line beside the switches instead of
 * beneath them, which is the whole reason a working-session layout is worth
 * having: the six events are readable at once rather than by scrolling.
 */
export function TabletNotificationMatrix() {
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

  const prefs = preferences as
    | { pushNotifications?: boolean; emailNotifications?: boolean }
    | undefined;
  const masters = {
    push: prefs?.pushNotifications ?? true,
    email: prefs?.emailNotifications ?? true,
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
    <View>
      <Text className="text-foreground text-2xl font-semibold tracking-tight">
        Notifications
      </Text>
      <Text className="text-muted mt-2 max-w-xl text-sm leading-5">
        Push is for when you are the blocker — an agent waiting on you, or work
        ready for your review. Everything stays in your in-app list either way,
        so turning a push off hides the interruption, not the record.
      </Text>

      <View className="mt-6 max-w-3xl">
        <View className="flex-row items-end pb-2">
          <View className="flex-1" />
          {notificationChannels.map((channel) => (
            <Text
              key={channel}
              className="text-muted w-20 text-center text-[11px] font-semibold uppercase tracking-wider"
            >
              {CHANNEL_LABELS[channel]}
            </Text>
          ))}
        </View>

        {isLoading ? (
          <Text className="text-muted">Loading…</Text>
        ) : (
          <View className="border-border bg-card overflow-hidden rounded-lg border">
            {matrix.map((row, index) => (
              <View
                key={row.type}
                className={`flex-row items-center px-4 py-3 ${
                  index > 0 ? "border-border border-t" : ""
                }`}
              >
                <View className="flex-1 pr-4">
                  <Text className="text-foreground text-sm font-medium">{row.label}</Text>
                  <Text className="text-muted mt-0.5 text-xs leading-4">{row.hint}</Text>
                </View>
                {notificationChannels.map((channel) => {
                  const cell = row.channels[channel];
                  return (
                    <View key={channel} className="w-20 items-center">
                      <Switch
                        value={cell.enabled}
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
            Push is off for this account, so that column is inactive. Your
            per-event choices are kept and return when you switch it back on.
          </Text>
        ) : null}
      </View>
    </View>
  );
}
