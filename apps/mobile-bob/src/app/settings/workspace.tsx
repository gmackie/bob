import { ScrollView } from "react-native";
import { Stack } from "expo-router";

import { WorkspacesSection } from "~/features/settings/sections";

/**
 * Phone shell: one section, pushed onto the stack.
 *
 * The section itself is shared with the tablet's detail pane, so the two
 * surfaces cannot drift into offering different settings.
 */
export default function WorkspacesSectionScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Workspace" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <WorkspacesSection />
      </ScrollView>
    </>
  );
}
