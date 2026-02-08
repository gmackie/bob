import "@xterm/xterm/css/xterm.css";
import "./dashboard.css";

import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { DashboardProviders } from "./_components/dashboard-providers";

export const dynamic = "force-dynamic";

interface DashboardLayoutProps {
  children: ReactNode;
  params: Promise<any>;
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <DashboardProviders>{children}</DashboardProviders>;
}
