import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { BilderDashboardProviders } from "./_providers";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <BilderDashboardProviders>{children}</BilderDashboardProviders>;
}
