import { Text } from "react-native";
import { Screen } from "~/components/ui/Screen";
import { ExplorationsPane } from "~/features/threads/ExplorationsPane";
import { colors } from "~/lib/colors";

export default function ExploreScreen() {
  return (
    <Screen>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontWeight: "700", fontSize: 22 }}
      >
        Explorations
      </Text>
      <ExplorationsPane />
    </Screen>
  );
}
