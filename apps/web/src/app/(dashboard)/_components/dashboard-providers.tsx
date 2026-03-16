"use client";

import {
  AuthProvider,
  CheatCodeProvider,
  ErrorProvider,
  ProgressProvider,
} from "~/contexts";
import { AppShell } from "~/components/layout/app-shell";

export function DashboardProviders(props: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ErrorProvider>
        <ProgressProvider>
          <CheatCodeProvider>
            <AppShell>{props.children}</AppShell>
          </CheatCodeProvider>
        </ProgressProvider>
      </ErrorProvider>
    </AuthProvider>
  );
}
