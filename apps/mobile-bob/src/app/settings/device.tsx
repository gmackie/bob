import { ScrollView } from "react-native";
import { Stack } from "expo-router";

import { DeviceSection } from "~/features/settings/sections";

/** Phone shell: the Device section, shared with the tablet's detail pane. */
export default function DeviceSectionScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Device" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <DeviceSection />
      </ScrollView>
    </>
  );
}
