"use client";

import {
  AuthProvider,
  CheatCodeProvider,
  ErrorProvider,
  ProgressProvider,
} from "~/contexts";

export function DashboardProviders(props: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ErrorProvider>
        <ProgressProvider>
          <CheatCodeProvider>
            <div className="dashboard-layout">{props.children}</div>
          </CheatCodeProvider>
        </ProgressProvider>
      </ErrorProvider>
    </AuthProvider>
  );
}
