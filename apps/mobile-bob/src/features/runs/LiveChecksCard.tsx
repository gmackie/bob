import { Text, View } from "react-native";

import { foldCheckEvents } from "./live-checks-model";
import type { CheckEventLike, CheckTone } from "./live-checks-model";

/**
 * The lights, for one run.
 *
 * Renders the runner's structured `check` events — one row per phase, updating
 * in place as each reports. This is the thing worth watching from a phone: a
 * row goes amber while a phase runs and green when it passes, without the
 * person doing anything.
 */

const DOT: Record<CheckTone, string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  grey: "bg-neutral-400",
};

export function LiveChecksCard({ events }: { events: readonly CheckEventLike[] }) {
  const rows = foldCheckEvents(events);

  // Before the first check arrives there is nothing honest to show — an empty
  // card would imply the run has no checks rather than that none have reported.
  if (rows.length === 0) return null;

  return (
    <View className="border-border bg-card mt-3 overflow-hidden rounded-lg border">
      {rows.map((row, index) => (
        <View
          key={row.phase}
          className={`flex-row items-center px-4 py-2.5 ${
            index > 0 ? "border-border border-t" : ""
          }`}
        >
          <View className={`mr-2 h-2.5 w-2.5 rounded-full ${DOT[row.tone]}`} />
          <Text className="text-foreground flex-1 text-sm">{row.phase}</Text>
          {row.countsLabel ? (
            <Text
              className={`text-xs ${
                row.tone === "red" ? "text-red-700 dark:text-red-400" : "text-muted"
              }`}
            >
              {row.countsLabel}
            </Text>
          ) : (
            <Text className="text-muted text-xs">{row.status}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
