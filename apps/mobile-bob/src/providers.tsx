import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CESPNotificationsProvider } from "./providers/cesp-notifications-provider";
import { authClient } from "./utils/auth";
import { usePushNotifications } from "./hooks/use-push-notifications";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Registers the device's Expo push token once the user is authenticated.
 * Renders nothing; the hook handles permission + server registration and
 * re-runs if the signed-in user changes.
 */
function PushNotificationsRegistrar() {
  const { data: session } = authClient.useSession();
  usePushNotifications(session?.user.id ?? null);
  return null;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SafeAreaProvider>
      <PushNotificationsRegistrar />
      <CESPNotificationsProvider>{children}</CESPNotificationsProvider>
    </SafeAreaProvider>
  );
}
