"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchStreamLink,
  loggerLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import SuperJSON from "superjson";

import type { AppRouter } from "@bob/api";
import { createQueryClient } from "./query-client";

let clientQueryClientSingleton: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") {
    return createQueryClient();
  }
  return (clientQueryClientSingleton ??= createQueryClient());
}

// Type the client against the full AppRouter so UI components compile
// regardless of which subset the active deploy target mounts. Cloudflare
// deploys still mount `edgeRouter` at the server layer — calls to excluded
// routes (git/capture/system/settings-full) 404 there. The Node/Electron
// target (Phase 2 `apps/bob-server`) will mount the full AppRouter.
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers: () => {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  return "http://localhost:5173";
}
