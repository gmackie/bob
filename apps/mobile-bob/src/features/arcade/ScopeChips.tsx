// Scope chips over the Arcade floor (BOB-91 slice 3): one per connected project and one per
// repo, from @bob/arcade's floorScopes(), the same chips the web cockpit draws. A chip
// narrows the floor, the HUD and the desks; tapping it again clears it.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { floorScopes, liveScope } from "@bob/arcade";
import type { FloorScopeChip } from "@bob/arcade";
import type { EdgeView, Scope } from "@bob/sdlc-view";

import { parcelFill } from "./arcade-model";
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
        gap: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? STAGE.labelLit : STAGE.belt,
        backgroundColor: active ? "#2a2116" : "transparent",
        paddingHorizontal: 9,
        paddingVertical: 3,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {chip.hue !== null ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: parcelFill(chip.hue) }} /> : null}
      <Text style={{ fontFamily: MONO, fontSize: 11, color: active ? STAGE.labelLit : STAGE.label }}>
        {chip.label} {chip.count}
        {chip.attention ? <Text style={{ color: "#e7a505" }}> !</Text> : null}
      </Text>
    </Pressable>
  );
}

export function ScopeChips({ view, scope, onScope }: { view: EdgeView; scope: Scope; onScope: (scope: Scope) => void }) {
  const { projects, repos } = useMemo(() => floorScopes(view, scope), [view, scope]);
  if (!projects.length && !repos.length) return null;
  const project = (c: FloorScopeChip) => scope.startupId === c.scope.startupId;
  const repo = (c: FloorScopeChip) => scope.repoKey === c.scope.repoKey;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 14, paddingBottom: 6 }} testID="arcade-scopes">
      {projects.map((c) => (
        <Chip key={c.key} chip={c} active={project(c)} onPress={() => onScope(project(c) ? {} : c.scope)} />
      ))}
      {projects.length && repos.length ? <View style={{ width: 1, marginHorizontal: 4, backgroundColor: STAGE.belt }} /> : null}
      {repos.map((c) => (
        <Chip key={c.key} chip={c} active={repo(c)} onPress={() => onScope(repo(c) ? (scope.startupId ? { startupId: scope.startupId } : {}) : c.scope)} />
      ))}
    </ScrollView>
  );
}
