import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BudgetMode, BudgetPolicy, BudgetStateWire } from "@bob/ws";

import { Card } from "~/components/ui";
import { rpc } from "~/utils/api";

import { buildBudgetGlance  } from "./budget-glance-model";
import type {GlanceTone} from "./budget-glance-model";

const BAR: Record<GlanceTone, string> = {
  ok: "bg-primary",
  attention: "bg-warning",
  down: "bg-danger",
  idle: "bg-muted",
};

const MODES: { mode: BudgetMode; label: string }[] = [
  { mode: "run", label: "Run" },
  { mode: "pause", label: "Pause 2h" },
  { mode: "boost", label: "Boost 2h" },
];

/** Pause and Boost from the phone last two hours. Outside render: it reads the clock. */
function twoHoursFromNow(): string {
  return new Date(Date.now() + 2 * 3_600_000).toISOString();
}

/**
 * Subscription budget at a glance (BOB-76). Owner-only: for anyone else the
 * API refuses and the card stays hidden. Mode buttons apply immediately — they
 * are the emergency levers; everything else lives in the web cockpit.
 */
export function BudgetGlanceCard() {
  const queryClient = useQueryClient();
  const query = useQuery(rpc("budget.state").queryOptions({}, { refetchInterval: 60_000, retry: false }));
  const mutation = useMutation(rpc("budget.setPolicy").mutationOptions({}));
  const [now, setNow] = useState(() => new Date());
  const data = query.data as unknown as { state: BudgetStateWire } | undefined;
  const glance = useMemo(() => (data ? buildBudgetGlance(data.state, now) : null), [data, now]);

  if (!glance || !data) return null;

  const setMode = (mode: BudgetMode) => {
    const policy: BudgetPolicy = { ...data.state.policy, mode };
    if (mode === "run") delete (policy as Partial<BudgetPolicy>).modeUntil;
    else policy.modeUntil = twoHoursFromNow();
    mutation.mutate(
      { policy: policy as unknown as Record<string, unknown>, note: `mobile: mode → ${mode}` },
      {
        onSuccess: () => {
          setNow(new Date());
          void queryClient.invalidateQueries();
        },
        onError: (error) => Alert.alert("Could not change the mode", error instanceof Error ? error.message : "Try again from the web cockpit."),
      },
    );
  };

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground text-base font-semibold">Budget</Text>
        <Text className="text-muted text-xs">{glance.enforce ? "enforcing" : "shadow"}</Text>
      </View>
      <Text className="text-muted mt-1 text-xs" testID="budget-headline">
        {glance.headline}
      </Text>

      <View className="mt-3 gap-2.5">
        {glance.rows.map((row) => (
          <View key={row.accountId} accessible accessibilityLabel={`${row.title}: ${row.detail}`}>
            <View className="flex-row items-baseline justify-between">
              <Text className="text-foreground text-[13px] font-medium" numberOfLines={1}>
                {row.title}
              </Text>
            </View>
            <View className="bg-muted/40 mt-1 h-1.5 overflow-hidden rounded-full">
              <View className="absolute h-full rounded-full bg-primary/30" style={{ width: `${row.landingPct}%` }} />
              <View className={`h-full rounded-full ${BAR[row.tone]}`} style={{ width: `${Math.max(row.tone === "down" ? 100 : 0, row.usedPct)}%` }} />
            </View>
            <Text className={`mt-0.5 text-[11px] ${row.tone === "down" ? "text-danger" : "text-muted"}`} numberOfLines={1}>
              {row.detail}
            </Text>
          </View>
        ))}
      </View>

      <View className="mt-3 flex-row gap-2" accessibilityRole="radiogroup">
        {MODES.map((m) => {
          const active = glance.mode === m.mode;
          return (
            <Pressable
              key={m.mode}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: mutation.isPending }}
              testID={`budget-mode-${m.mode}`}
              disabled={mutation.isPending || active}
              onPress={() => setMode(m.mode)}
              className={`flex-1 items-center rounded-lg border py-2 active:opacity-70 ${active ? (m.mode === "pause" ? "bg-danger border-danger" : "bg-primary border-primary") : "border-border"}`}
            >
              <Text className={`text-xs font-semibold ${active ? "text-primary-foreground" : "text-foreground"}`}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {glance.modeUntil ? (
        <Text className="text-muted mt-1.5 text-[11px]">
          until {new Date(glance.modeUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </Text>
      ) : null}
    </Card>
  );
}
