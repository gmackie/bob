import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#111113" },
          headerTintColor: "#D4A04A",
          contentStyle: { backgroundColor: "#111113" },
        }}
      />
    </>
  );
}
