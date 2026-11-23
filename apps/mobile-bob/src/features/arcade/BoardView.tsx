// The projects board (BOB-99): the Arcade's opening view once the edge carries Kanbanger
// issues. One row per project: a glowing segmented bar of its open work by lane, with the
// stale part last and orange, and the stale count on the right. Tapping opens that floor.
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
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 10,
        marginBottom: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#282017",
        backgroundColor: "#17120d",
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: row.active > 0 ? "#6fb4ff" : "#5e4e3a" }} />
      <Text numberOfLines={1} style={{ width: 92, fontFamily: MONO, fontSize: 11, fontWeight: "700", color: "#efe3cd" }}>
        {row.name}
      </Text>
      <View
        style={{
          flex: 1,
          height: 13,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: "#2d241a",
          overflow: "hidden",
          backgroundColor: "#0b0907",
          padding: 1.5,
          flexDirection: "row",
        }}
      >
        <View style={{ width: `${(total / max) * 100}%`, flexDirection: "row", gap: 1, borderRadius: 5, overflow: "hidden" }}>
          {barSegments(row).map((s) => (
            <View key={s.key} style={{ flex: s.value, backgroundColor: s.color }} />
          ))}
        </View>
      </View>
      <Text style={{ width: 28, textAlign: "right", fontFamily: MONO, fontSize: 11, fontWeight: "800", color: row.stale ? STALE_COLOR : STAGE.label }}>{row.stale}</Text>
    </Pressable>
  );
}

export function BoardView({ board, onOpenProject }: { board: Board; onOpenProject: (row: BoardRow) => void }) {
  const max = Math.max(1, ...board.rows.map((r) => r.lanes.queue + r.active));
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }} testID="arcade-board">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1.2, color: STAGE.label }}>
          CONNECTED PROJECTS · <Text style={{ color: STAGE.labelLit, fontWeight: "900" }}>{board.started}</Text> STARTED
          {board.failed ? <Text style={{ color: PARCEL_TONE.failed.fill }}>{`  ·  ${board.failed} RED`}</Text> : null}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1.2, color: STAGE.label }}>
          STALE <Text style={{ color: STALE_COLOR, fontWeight: "900" }}>{board.stale}</Text>
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 4, paddingBottom: 10 }} accessible={false}>
        {BOARD_LANES.map((lane) => (
          <View key={lane} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 5, backgroundColor: "#1a140e", paddingHorizontal: 6, paddingVertical: 2 }}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: LANE_FILL[lane] }} />
            <Text style={{ fontFamily: MONO, fontSize: 9, color: STAGE.label }}>{LANE_LABEL[lane]}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 5, backgroundColor: "#1a140e", paddingHorizontal: 6, paddingVertical: 2 }}>
          <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: STALE_COLOR }} />
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
