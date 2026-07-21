"use client";

import { createContext, useContext, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createBobRpcClient,
  type BobClientOptions,
  type BobRpcClient,
} from "@gmacko/bob-client";

import { createQueryClient } from "~/trpc/query-client";

let clientQueryClientSingleton: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    return createQueryClient();
  }
  return (clientQueryClientSingleton ??= createQueryClient());
}

const BobRpcContext = createContext<BobRpcClient | null>(null);

export function BobRpcProvider(props: {
  children: React.ReactNode;
  options?: Partial<BobClientOptions>;
}) {
  const queryClient = getQueryClient();
  const [client] = useState(() =>
    createBobRpcClient({
      baseURL: getBaseUrl() + "/api/rpc",
      headers: {
        "x-rpc-source": "bob-react",
      },
      // Effect's FetchHttpClient issues fetch() with no `credentials`, so the
      // better-auth session cookie never reached /api/rpc and every Effect-RPC
      // call failed auth with UnauthorizedError("No credentials"). That silently
      // emptied every Effect-RPC-backed panel (Running Now, provider capacity
      // cards) while the tRPC-backed panels worked. Force credentials on the
      // wire so the cookie is always sent.
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, credentials: "include" })) as typeof fetch,
      ...props.options,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BobRpcContext.Provider value={client}>
        {props.children}
      </BobRpcContext.Provider>
    </QueryClientProvider>
  );
}

export function useBobRpcClient(): BobRpcClient {
  const client = useContext(BobRpcContext);
  if (!client) {
    throw new Error("useBobRpcClient must be used within BobRpcProvider");
  }
  return client;
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  return "http://localhost:5173";
}
