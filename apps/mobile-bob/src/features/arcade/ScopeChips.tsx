// Scope chips over the Arcade floor (BOB-91 slice 3): luminous arcade filter pills per
// connected project and repo, from @bob/arcade's floorScopes().
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { floorScopes, liveScope } from "@bob/arcade";
import type { FloorScopeChip } from "@bob/arcade";
import type { EdgeView, Scope } from "@bob/sdlc-view";

import { STAGE } from "./FloorView";

const MONO = "Menlo";

/** The chosen scope, minus anything that left the view; the same object while unchanged. */
export function useFloorScope(view: EdgeView): [Scope, (scope: Scope) => void] {
  const [picked, setPicked] = useState<Scope>({});
  const { startupId, repoKey } = useMemo(() => liveScope(view, picked), [view, picked]);
  const scope = useMemo<Scope>(() => ({ ...(startupId ? { startupId } : {}), ...(repoKey ? { repoKey } : {}) }), [startupId, repoKey]);
  return [scope, setPicked];
}

function Chip({ chip, active, onPress }: { chip: FloorScopeChip; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${chip.level} ${chip.label}, ${chip.count} items${chip.attention ? `, ${chip.attention} need attention` : ""}`}
      testID={`arcade-scope-${chip.key}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? STAGE.labelLit : "#3a2e20",
        backgroundColor: active ? "#2c2215" : "#18130d",
        paddingHorizontal: 10,
        paddingVertical: 4,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      {chip.hue !== null ? (
        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: `hsl(${chip.hue}, 74%, 56%)` }} />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? STAGE.labelLit : "#6a5638" }} />
      )}
      <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: active ? "800" : "600", color: active ? STAGE.labelLit : "#a89270" }}>
        {chip.label}
      </Text>
      <View style={{ borderRadius: 4, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 4, paddingVertical: 0.5 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: "700", color: active ? STAGE.labelLit : STAGE.label }}>{chip.count}</Text>
      </View>
      {chip.attention ? <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "900", color: "#e7a505" }}>!</Text> : null}
    </Pressable>
  );
}

export function ScopeChips({ view, scope, onScope }: { view: EdgeView; scope: Scope; onScope: (scope: Scope) => void }) {
  const { projects, repos } = useMemo(() => floorScopes(view, scope), [view, scope]);
  if (!projects.length && !repos.length) return null;
  const project = (c: FloorScopeChip) => scope.startupId === c.scope.startupId;
  const repo = (c: FloorScopeChip) => scope.repoKey === c.scope.repoKey;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: "center", gap: 6, paddingHorizontal: 14, paddingBottom: 8 }}
      testID="arcade-scopes"
    >
      {projects.map((c) => (
        <Chip key={c.key} chip={c} active={project(c)} onPress={() => onScope(project(c) ? {} : c.scope)} />
      ))}
      {projects.length && repos.length ? <View style={{ width: 1, height: 14, marginHorizontal: 4, backgroundColor: "#3a2f22" }} /> : null}
      {repos.map((c) => (
        <Chip key={c.key} chip={c} active={repo(c)} onPress={() => onScope(repo(c) ? (scope.startupId ? { startupId: scope.startupId } : {}) : c.scope)} />
      ))}
    </ScrollView>
  );
}
