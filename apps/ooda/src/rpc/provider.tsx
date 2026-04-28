"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}

export function RpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
