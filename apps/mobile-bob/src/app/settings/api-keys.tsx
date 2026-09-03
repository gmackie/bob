import { ScrollView } from "react-native";
import { Stack } from "expo-router";

import { ApiKeysSection } from "~/features/settings/sections";

/**
 * Phone shell: one section, pushed onto the stack.
 *
 * The section itself is shared with the tablet's detail pane, so the two
 * surfaces cannot drift into offering different settings.
 */
export default function ApiKeysSectionScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Api Keys" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <ApiKeysSection />
      </ScrollView>
    </>
  );
}
