import "@xterm/xterm/css/xterm.css";
// dashboard.css removed — 4000+ lines of legacy CSS that overrode DESIGN.md
// (font-family, background gradients, color scheme all conflicted with tailwind theme)

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
