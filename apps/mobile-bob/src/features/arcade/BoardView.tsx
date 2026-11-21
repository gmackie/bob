// The projects board (BOB-99): the Arcade's opening view once the edge carries Kanbanger
// issues. One row per project: a bar of its open work by lane, with the stale part last and
// orange, and the stale count on the right. Tapping a row opens that project's floor.
import { Pressable, ScrollView, Text, View } from "react-native";
import { BOARD_LANES, boardRowSummary, PARCEL_TONE } from "@bob/arcade";
import type { Board, BoardLane, BoardRow } from "@bob/arcade";

import { STAGE } from "./FloorView";

const MONO = "Menlo";
export const STALE_COLOR = "#ff9f43";
const LANE_FILL: Record<BoardLane, string> = {
  queue: PARCEL_TONE.queued.fill,
  working: PARCEL_TONE.agents.fill,
  ci: PARCEL_TONE.ci.fill,
  review: PARCEL_TONE.review.fill,
  deploy: PARCEL_TONE.deploy.fill,
};
const LANE_LABEL: Record<BoardLane, string> = { queue: "todo", working: "doing", ci: "CI", review: "review", deploy: "deploy" };

/**
 * Bar segments for a row: queue, then the fresh part of each active lane, then stale. Stale
 * is a subset of the active lanes, so it is taken off them in proportion.
 */
export function barSegments(row: BoardRow): { key: string; value: number; color: string }[] {
  const fresh = Math.max(0, row.active - row.stale);
  const scale = row.active > 0 ? fresh / row.active : 0;
  const segments: { key: string; value: number; color: string }[] = BOARD_LANES.map((lane) => ({ key: lane, value: lane === "queue" ? row.lanes.queue : row.lanes[lane] * scale, color: LANE_FILL[lane] }));
  segments.push({ key: "stale", value: row.stale, color: STALE_COLOR });
  return segments.filter((s) => s.value > 0);
}

function Row({ row, max, onPress }: { row: BoardRow; max: number; onPress: (row: BoardRow) => void }) {
  const total = row.lanes.queue + row.active;
  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={boardRowSummary(row)}
      testID={`arcade-board-row-${row.projectId}`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#2a231a", opacity: pressed ? 0.6 : 1 })}
    >
      <Text numberOfLines={1} style={{ width: 96, fontFamily: MONO, fontSize: 11, color: "#e9dcc4" }}>
        {row.name}
      </Text>
      <View style={{ flex: 1, height: 12, borderRadius: 3, overflow: "hidden", backgroundColor: "#241d15", flexDirection: "row" }}>
        <View style={{ width: `${(total / max) * 100}%`, flexDirection: "row" }}>
          {barSegments(row).map((s) => (
            <View key={s.key} style={{ flex: s.value, backgroundColor: s.color }} />
          ))}
        </View>
      </View>
      <Text style={{ width: 30, textAlign: "right", fontFamily: MONO, fontSize: 11, fontWeight: "700", color: row.stale ? STALE_COLOR : STAGE.label }}>{row.stale}</Text>
    </Pressable>
  );
}

export function BoardView({ board, onOpenProject }: { board: Board; onOpenProject: (row: BoardRow) => void }) {
  const max = Math.max(1, ...board.rows.map((r) => r.lanes.queue + r.active));
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }} testID="arcade-board">
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: STAGE.label }}>
          ALL PROJECTS · <Text style={{ color: STAGE.labelLit, fontWeight: "800" }}>{board.started}</Text> STARTED
          {board.failed ? <Text style={{ color: PARCEL_TONE.failed.fill }}>{`  ·  ${board.failed} RED`}</Text> : null}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: STAGE.label }}>
          STALE <Text style={{ color: STALE_COLOR, fontWeight: "800" }}>{board.stale}</Text>
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, paddingBottom: 6 }} accessible={false}>
        {BOARD_LANES.map((lane) => (
          <View key={lane} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: LANE_FILL[lane] }} />
            <Text style={{ fontFamily: MONO, fontSize: 9, color: STAGE.label }}>{LANE_LABEL[lane]}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: STALE_COLOR }} />
          <Text style={{ fontFamily: MONO, fontSize: 9, color: STAGE.label }}>untouched 7d+</Text>
        </View>
      </View>
      {board.rows.length === 0 ? (
        <Text style={{ color: STAGE.label, paddingVertical: 24, textAlign: "center" }}>No open work in any project.</Text>
      ) : (
        board.rows.map((row) => <Row key={row.projectId} row={row} max={max} onPress={onOpenProject} />)
      )}
    </ScrollView>
  );
}
