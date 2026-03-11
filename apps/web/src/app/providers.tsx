"use client";

import type { ReactNode } from "react";

import { CESPNotificationsProvider } from "~/app/cesp-notifications-provider";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <CESPNotificationsProvider>{children}</CESPNotificationsProvider>;
}
