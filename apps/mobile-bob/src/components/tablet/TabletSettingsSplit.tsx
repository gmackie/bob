import { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Platform } from "react-native";

import {
  AccountSection,
  ApiKeysSection,
  DeviceSection,
  PreferencesSection,
  ProvidersSection,
  WorkspacesSection,
} from "~/features/settings/sections";
import {
  SETTINGS_SECTIONS,
  resolveSettingsShell,
} from "~/features/settings/settings-shell-model";
import type { SettingsSectionKey } from "~/features/settings/settings-shell-model";

import { TabletNotificationMatrix } from "./TabletNotificationMatrix";
import type { ProviderKey } from "~/features/tablet/dashboard";

/**
 * Tablet settings: rail on the left, section on the right.
 *
 * The tablet is for working sessions, so a person keeps the list and the
 * detail on screen together and moves between sections without losing their
 * place — where the phone pushes one screen at a time for review on the road.
 *
 * The SECTIONS are shared with the phone routes; only the shell differs.
 * Duplicating them is how two surfaces drift into having different settings.
 */
export interface TabletSettingsSplitProps {
  /** Opens a provider's own pane — the tablet keeps provider detail in the
   *  cockpit rather than pushing a route, so the callback is passed through
   *  from the shell rather than handled here. */
  onOpenProvider?: (provider: ProviderKey) => void;
}

export function TabletSettingsSplit({ onOpenProvider }: TabletSettingsSplitProps) {
  const { width } = useWindowDimensions();
  const shell = resolveSettingsShell({
    isTablet: Platform.OS === "ios" && (Platform as { isPad?: boolean }).isPad === true,
    width,
  });
  const [selected, setSelected] = useState<SettingsSectionKey>(
    shell.initialSection ?? "account",
  );

  return (
    <View className="bg-background flex-1 flex-row">
      {/* Rail. Fixed width so the detail pane keeps a stable measure as the
          window resizes — a proportional rail makes text reflow on every
          Split View drag. */}
      <View className="border-border w-64 border-r">
        <ScrollView contentContainerClassName="py-3">
          <Text className="text-muted px-4 pb-2 text-xs font-semibold uppercase tracking-wider">
            Settings
          </Text>
          {SETTINGS_SECTIONS.map((section) => {
            const isSelected = section.key === selected;
            return (
              <Pressable
                key={section.key}
                onPress={() => setSelected(section.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={section.label}
                className={`px-4 py-3 ${isSelected ? "bg-card" : "active:opacity-70"}`}
              >
                <Text
                  className={`text-sm ${
                    isSelected ? "text-foreground font-semibold" : "text-foreground"
                  }`}
                >
                  {section.label}
                </Text>
                {/* Room for a blurb here that the phone index cannot spare. */}
                <Text className="text-muted mt-0.5 text-xs leading-4" numberOfLines={2}>
                  {section.blurb}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="p-6 pb-16">
        {selected === "account" ? <AccountSection /> : null}
        {selected === "workspace" ? <WorkspacesSection /> : null}
        {selected === "notifications" ? <TabletNotificationMatrix /> : null}
        {selected === "providers" ? (
          <ProvidersSection onOpenProvider={onOpenProvider} />
        ) : null}
        {selected === "apiKeys" ? <ApiKeysSection /> : null}
        {selected === "device" ? <DeviceSection /> : null}
        {selected === "appearance" ? <PreferencesSection /> : null}
      </ScrollView>
    </View>
  );
}
