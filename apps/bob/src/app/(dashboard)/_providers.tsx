"use client";

import dynamic from "next/dynamic";
import { ExecutionAvailabilityProvider } from "~/hooks/execution-availability";

// Lazy-load the shell to avoid SSR issues with useQuery/useQueryClient
// on Cloudflare Workers where the QueryClientProvider isn't available during SSR
const BilderShell = dynamic(() => import("./_shell"), { ssr: false });

export function BilderDashboardProviders({ children, executionAvailable = true }: { children: React.ReactNode; executionAvailable?: boolean }) {
  return <ExecutionAvailabilityProvider available={executionAvailable}><BilderShell>{children}</BilderShell></ExecutionAvailabilityProvider>;
}
