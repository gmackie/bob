import type { ReactNode } from "react";

import { CESPNotificationsProvider } from "./providers/cesp-notifications-provider";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <CESPNotificationsProvider>{children}</CESPNotificationsProvider>;
}
