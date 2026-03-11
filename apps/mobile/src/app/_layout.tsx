import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "~/utils/api";
import { Providers } from "../providers";

import "../styles.css";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: "#0B0F14",
            },
            animation: "fade",
          }}
        />
        <StatusBar style="light" />
      </Providers>
    </QueryClientProvider>
  );
}
