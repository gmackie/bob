"use client";

import { ReactNode } from "react";

import {
  AuthProvider,
  CheatCodeProvider,
  ErrorProvider,
  ProgressProvider,
} from "~/contexts";

import "@xterm/xterm/css/xterm.css";
import "./dashboard.css";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <AuthProvider>
      <ErrorProvider>
        <ProgressProvider>
          <CheatCodeProvider>
            <div className="dashboard-layout">{children}</div>
          </CheatCodeProvider>
        </ProgressProvider>
      </ErrorProvider>
    </AuthProvider>
  );
}
