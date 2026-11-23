import { Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";

import {
  bannerFor,
  browseHref,
  browseModel,
  drillParams,
  itemHref
  
} from "~/features/sdlc/attention-model";
import type {BrowseParams} from "~/features/sdlc/attention-model";
import { ActionButtons, AttentionDot, OfflineBanner, Section, StateTileGrid } from "~/features/sdlc/components";
import { planTarget } from "~/features/sdlc/confirm-model";
import { useNow, useSdlcEdge } from "~/features/sdlc/use-sdlc-edge";
import { colors } from "~/lib/colors";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The SDLC drill-down: fleet → project → repo as state tiles plus the next level's
 * groups (the phone's graph), then a plan as a list. Tapping a tile filters to that
 * state; tapping it again clears the filter.
 */
export default function SdlcBrowseScreen() {
  const raw = useLocalSearchParams<{ project?: string; repo?: string; plan?: string; state?: string }>();
  const params: BrowseParams = { project: first(raw.project), repo: first(raw.repo), plan: first(raw.plan), state: first(raw.state) };
  const { state, send, retry } = useSdlcEdge();
  const now = useNow();
  const banner = bannerFor(state.view, state.connection, now, state.error);
  const model = browseModel(state.view, params);
  const groups = model.groups;
  const go = (next: BrowseParams) => router.push(browseHref(next));
  const replace = (next: BrowseParams) => router.setParams({ ...next, state: next.state ?? "" });

  return (
    <>
      <Stack.Screen options={{ title: model.title }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12" testID="sdlc-browse">
        <OfflineBanner banner={banner} now={now} onRetry={retry} />

        <View className="mb-3 flex-row flex-wrap items-center">
          {model.crumbs.map((crumb, index) => (
            <View key={`${crumb.label}-${index}`} className="flex-row items-center">
              {index > 0 ? <Text className="text-muted mx-1 text-xs">›</Text> : null}
              {crumb.href !== null ? (
                <Pressable onPress={() => crumb.href !== null && router.push(crumb.href)} accessibilityRole="link">
                  <Text className="text-accent text-xs font-semibold">{crumb.label}</Text>
                </Pressable>
              ) : (
                <Text className="text-foreground text-xs font-semibold">{crumb.label}</Text>
              )}
            </View>
          ))}
        </View>

        {model.status === "waiting" ? <Text className="text-muted text-sm">Waiting for the first snapshot…</Text> : null}
        {model.status === "empty" ? <Text className="text-muted text-sm">No active plans.</Text> : null}

        {model.tiles ? (
          <StateTileGrid
            tiles={model.tiles}
            onSelect={(tile) => replace({ ...params, state: tile.selected ? undefined : tile.state })}
          />
        ) : null}

        {model.plan ? (
          <Section title={`Plan · ${model.plan.state}`}>
            <ActionButtons
              options={model.planActions}
              target={planTarget(model.plan.planId)}
              ctx={{ connection: state.connection, banner, hasView: state.view.epoch !== null, commands: state.commands }}
              send={(option, confirm) => send(option.command, option.label, confirm)}
            />
          </Section>
        ) : null}

        {groups && !model.state ? (
          <Section title={groups.level === "project" ? "Projects" : "Repositories"}>
            {groups.items.map((group) => (
              <Pressable
                key={group.key}
                onPress={() => go(drillParams(params, groups.level, group))}
                accessibilityRole="button"
                className="mb-2 flex-row items-center justify-between rounded-2xl px-4 py-3 active:opacity-70"
                style={{ backgroundColor: colors.card }}
              >
                <Text className="text-foreground flex-1 text-base font-semibold" numberOfLines={1}>{group.label}</Text>
                <Text className="text-muted text-xs">
                  {group.count} item{group.count === 1 ? "" : "s"}
                  {group.attention > 0 ? <Text style={{ color: colors.accent }}> · {group.attention} need you</Text> : null}
                </Text>
              </Pressable>
            ))}
          </Section>
        ) : null}

        {model.plans ? (
          <Section title="Plans">
            {model.plans.map((plan) => (
              <Pressable
                key={plan.planId}
                onPress={() => go({ project: params.project, repo: params.repo, plan: plan.planId })}
                accessibilityRole="button"
                className="mb-2 flex-row items-center justify-between rounded-2xl px-4 py-3 active:opacity-70"
                style={{ backgroundColor: colors.card }}
              >
                <View className="flex-1">
                  <Text className="text-foreground text-base font-semibold">{plan.label}</Text>
                  <Text className="text-muted text-xs">{plan.state}</Text>
                </View>
                <Text className="text-muted text-xs">
                  {plan.count}
                  {plan.attention > 0 ? <Text style={{ color: colors.accent }}> · {plan.attention} need you</Text> : null}
                </Text>
              </Pressable>
            ))}
          </Section>
        ) : null}

        {model.items ? (
          <Section title={model.state ? `Items · ${model.state}` : "Items"}>
            {model.items.length === 0 ? <Text className="text-muted text-sm">No items here.</Text> : null}
            {model.items.map((item) => (
              <Pressable
                key={item.itemId}
                onPress={() => router.push(itemHref(item.itemId))}
                accessibilityRole="button"
                className="mb-2 rounded-2xl px-4 py-3 active:opacity-70"
                style={{ backgroundColor: colors.card }}
              >
                <View className="flex-row items-center gap-2">
                  <AttentionDot attention={item.attention} />
                  <Text className="text-foreground flex-1 text-base font-semibold" numberOfLines={1}>{item.title}</Text>
                  <Text className="text-xs" style={{ color: colors.secondaryForeground }}>{item.stateLabel}</Text>
                </View>
                <Text className="text-muted mt-1 text-xs">{item.repo}</Text>
              </Pressable>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}
