"use client";

import { ThemeProvider } from "@gmacko/ui";
import type { Mode, Theme } from "@gmacko/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { GmackoClientOptions } from "@gmacko/core/client";

import { CurrentUserProvider } from "./current-user-provider";
import { RpcClientProvider } from "./rpc-client-provider";
import { ToastProvider } from "./toast";

export interface GmackoAppProvidersProps {
  readonly children: ReactNode;
  readonly defaultTheme: Theme;
  readonly defaultMode?: Mode;
  readonly rpcOptions: GmackoClientOptions;
  /**
   * Override the QueryClient if you need shared cache across multiple roots.
   * Default: a fresh QueryClient with staleTime 30s and retry: false.
   */
  readonly queryClient?: QueryClient;
}

const DEFAULT_QUERY_CLIENT_OPTIONS = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false as const,
    },
  },
};

/**
 * Bundled provider stack. Renders, in dependency order:
 *
 *   ThemeProvider → QueryClientProvider → RpcClientProvider →
 *     ToastProvider → CurrentUserProvider → children
 *
 * Each provider is also exported individually for advanced cases (e.g. when
 * an app needs to share a QueryClient across multiple subtrees).
 */
export function GmackoAppProviders({
  children,
  defaultTheme,
  defaultMode,
  rpcOptions,
  queryClient,
}: GmackoAppProvidersProps) {
  const [internalQueryClient] = useState(
    () => queryClient ?? new QueryClient(DEFAULT_QUERY_CLIENT_OPTIONS),
  );

  return (
    <ThemeProvider defaultTheme={defaultTheme} defaultMode={defaultMode}>
      <QueryClientProvider client={internalQueryClient}>
        <RpcClientProvider options={rpcOptions}>
          <ToastProvider>
            <CurrentUserProvider>{children}</CurrentUserProvider>
          </ToastProvider>
        </RpcClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
