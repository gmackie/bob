import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { ObservabilityIdentity } from "~/lib/observability-browser";
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

  return (
    <BilderDashboardProviders>
      <ObservabilityIdentity
        user={{
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }}
        tenant={
          process.env.BOB_TENANT_ID
            ? { tenantId: process.env.BOB_TENANT_ID }
            : undefined
        }
      />
      {children}
    </BilderDashboardProviders>
  );
}
