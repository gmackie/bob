"use client";

import dynamic from "next/dynamic";

// Lazy-load the shell to avoid SSR issues with useQuery/useQueryClient
// on Cloudflare Workers where the QueryClientProvider isn't available during SSR
const BilderShell = dynamic(() => import("./_shell"), { ssr: false });

export function BilderDashboardProviders({ children }: { children: React.ReactNode }) {
  return <BilderShell>{children}</BilderShell>;
}
