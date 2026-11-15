import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Attention, CommandOption, Confirmation } from "@bob/sdlc-view";

import { colors } from "~/lib/colors";
import type { StateTile } from "./attention-model";
import { bannerText } from "./attention-model";
import { actionButtons, latestFor, outcomeText, resourceIdOf   } from "./commands-model";
import type {ActionContext, Banner} from "./commands-model";
import { ConfirmSheet } from "./sheets";

export const ATTENTION_COLOR: Record<Attention, string> = {
  needs_human: colors.accent,
  failed: colors.danger,
  stalled: colors.warning,
  ok: colors.muted,
};

export function AttentionDot({ attention }: { attention: Attention }) {
  return <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ATTENTION_COLOR[attention] }} />;
}

export function OfflineBanner({ banner, now, onRetry }: { banner: Banner | null; now: number; onRetry?: () => void }) {
  if (!banner) return null;
  const severe = banner.kind === "auth-failed" || banner.kind === "coordinator-offline";
  return (
    <View
      testID="sdlc-offline-banner"
      accessibilityRole="alert"
      className="mb-3 flex-row items-center gap-3 rounded-xl border px-3 py-2"
      style={{ borderColor: severe ? colors.warning : colors.border, backgroundColor: colors.card }}
    >
      <Text className="flex-1 text-xs" style={{ color: severe ? colors.warning : colors.secondaryForeground }}>
        {bannerText(banner, now)}
      </Text>
      {banner.kind === "auth-failed" && onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" className="active:opacity-70">
          <Text className="text-accent text-xs font-semibold">Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The phone's graph at L1–L3: one tile per state, tap to filter. */
export function StateTileGrid({ tiles, onSelect }: { tiles: StateTile[]; onSelect: (tile: StateTile) => void }) {
  return (
    <View className="flex-row flex-wrap justify-between gap-y-2" testID="sdlc-state-tiles">
      {tiles.map((tile) => {
        const hot = tile.count > 0 && tile.attention !== "ok";
        return (
          <Pressable
            key={tile.state}
            onPress={() => onSelect(tile)}
            accessibilityRole="button"
            accessibilityState={{ selected: tile.selected }}
            accessibilityLabel={`${tile.label}, ${tile.count}`}
            className="rounded-xl border px-3 py-2 active:opacity-70"
            style={{
              width: "32%",
              opacity: tile.count === 0 && !tile.selected ? 0.45 : 1,
              borderColor: tile.selected ? colors.accent : hot ? ATTENTION_COLOR[tile.attention] : colors.border,
              backgroundColor: tile.selected ? colors.cardElevated : colors.card,
            }}
          >
            <Text className="text-xl font-semibold" style={{ color: hot ? ATTENTION_COLOR[tile.attention] : colors.foreground }}>
              {tile.count}
            </Text>
            <Text className="text-muted text-[11px]" numberOfLines={1}>{tile.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="text-muted mb-2 text-xs font-semibold uppercase">{title}</Text>
      {children}
    </View>
  );
}

/**
 * Buttons for a resource's command options. Tier 1 sends at once; tier 2 and 3 open
 * the confirmation sheet. The latest outcome for the resource shows under them.
 */
export function ActionButtons({
  options,
  target,
  ctx,
  send,
}: {
  options: CommandOption[];
  target: string;
  ctx: ActionContext;
  send: (option: CommandOption, confirm?: Confirmation) => void;
}) {
  const [confirming, setConfirming] = useState<CommandOption | null>(null);
  const [firstOption] = options;
  if (!firstOption) return null;
  const buttons = actionButtons(options, ctx);
  const latest = latestFor(ctx.commands, resourceIdOf(firstOption.command));
  const reason = buttons.find((b) => b.reason)?.reason ?? null;
  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {buttons.map((b) => (
          <Pressable
            key={b.key}
            disabled={b.disabled}
            onPress={() => (b.option.tier === 1 ? send(b.option) : setConfirming(b.option))}
            accessibilityRole="button"
            accessibilityState={{ disabled: b.disabled, busy: b.pending }}
            className={`rounded-xl border px-4 py-2.5 ${b.disabled ? "opacity-40" : "active:opacity-70"}`}
            style={{ borderColor: b.option.destructive ? colors.danger : colors.border, backgroundColor: colors.cardElevated }}
          >
            <Text className="font-semibold" style={{ color: b.option.destructive ? colors.danger : colors.foreground }}>
              {b.pending ? "… " : ""}
              {b.option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {reason ? <Text className="text-muted mt-2 text-xs">{reason}</Text> : null}
      {latest ? <Text className="text-secondary-foreground mt-2 text-xs">{outcomeText(latest)}</Text> : null}
      <ConfirmSheet
        option={confirming}
        target={target}
        onCancel={() => setConfirming(null)}
        onConfirm={(option, confirm) => {
          setConfirming(null);
          send(option, confirm);
        }}
      />
    </View>
  );
}
