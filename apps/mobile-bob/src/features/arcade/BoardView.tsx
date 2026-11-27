import { useState, type ReactElement } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BOARD_LANES, boardRowSummary, BOARD_LANE_INK } from "@bob/arcade";
import type { Board, BoardRow } from "@bob/arcade";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });
function ProjectCard({ row, open }: { row: BoardRow; open: (row: BoardRow) => void }) {
  return (
    <Pressable
      onPress={() => open(row)}
      accessibilityRole="button"
      accessibilityLabel={boardRowSummary(row)}
      testID={`arcade-board-row-${row.projectId}`}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      <View style={s.top}>
        <Text numberOfLines={2} style={s.name}>
          {row.name}
        </Text>
        <Text style={s.arrow} accessibilityElementsHidden>
          ↗
        </Text>
      </View>
      <View style={s.lanes}>
        {BOARD_LANES.map((lane) => {
          const count = row.lanes[lane];
          const { label, color } = BOARD_LANE_INK[lane];
          return (
            <View key={lane} style={s.lane}>
              <View style={[s.track, { backgroundColor: count ? color : "#36403d" }]} />
              <Text style={[s.number, { color: count ? "#fff2d9" : "#8e9993" }]}>{count}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={s.laneName}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      {!!(row.failed || row.stale || row.backlog) && (
        <View style={s.details}>
          {row.failed > 0 && <Text style={[s.detail, { color: "#ffa18e" }]}>{row.failed} failed</Text>}
          {row.stale > 0 && <Text style={[s.detail, { color: "#f5bb77" }]}>{row.stale} stale</Text>}
          {row.backlog > 0 && <Text style={s.detail}>{row.backlog} in backlog</Text>}
        </View>
      )}
    </Pressable>
  );
}

export function BoardView({
  board,
  onOpenProject,
  header,
  footer,
}: {
  board: Board;
  onOpenProject: (row: BoardRow) => void;
  header: ReactElement;
  footer: ReactElement;
}) {
  const [width, setWidth] = useState(0);
  const columns = width >= 1040 ? 3 : width >= 620 ? 2 : 1;
  return (
    <View style={s.board} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="arcade-board">
      <FlatList
        key={columns}
        data={board.rows}
        numColumns={columns}
        keyExtractor={(row) => row.projectId}
        columnWrapperStyle={columns > 1 ? s.row : undefined}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View>
            {header}
            <View style={s.heading}>
              <Text accessibilityRole="header" style={s.headingText}>
                Connected projects
              </Text>
              <Text style={s.totals}>{board.started} started</Text>
            </View>
          </View>
        }
        ListFooterComponent={footer}
        ListEmptyComponent={<Text style={s.empty}>No open work in any project.</Text>}
        renderItem={({ item }) => <ProjectCard row={item} open={onOpenProject} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  board: { flex: 1 },
  list: { paddingBottom: 16, gap: 9 },
  row: { gap: 0 },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 14,
    paddingBottom: 3,
    flexWrap: "wrap",
  },
  headingText: { color: "#f5e8cd", fontSize: 20, fontWeight: "800", letterSpacing: -0.6 },
  totals: { fontFamily: mono, fontSize: 11, color: "#c2b397" },
  card: {
    flex: 1,
    marginHorizontal: 9,
    minWidth: 0,
    borderRadius: 13,
    backgroundColor: "#1d2423",
    borderWidth: 1,
    borderColor: "#3b4540",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 9,
  },
  pressed: { backgroundColor: "#2c3833", borderColor: "#bcab82" },
  top: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flex: 1, color: "#fff0d5", fontSize: 17, fontWeight: "700" },
  arrow: { color: "#b6cfbe", fontSize: 17 },
  lanes: { flexDirection: "row", gap: 5 },
  lane: { flex: 1, minWidth: 0 },
  track: { height: 3, borderRadius: 2, marginBottom: 4 },
  number: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  laneName: { color: "#c0c9bf", fontSize: 10, fontWeight: "500" },
  details: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  detail: { color: "#c0c9bf", fontFamily: mono, fontSize: 10 },
  empty: { color: "#c0c9bf", paddingVertical: 20 },
});
