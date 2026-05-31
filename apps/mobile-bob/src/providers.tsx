import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CESPNotificationsProvider } from "./providers/cesp-notifications-provider";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SafeAreaProvider>
      <CESPNotificationsProvider>{children}</CESPNotificationsProvider>
    </SafeAreaProvider>
  );
}
