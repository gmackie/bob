"use client";

import { createContext, useContext, useState } from "react";
import {
  createGmackoRpcClient,
  type GmackoClientOptions,
} from "@gmacko/client";

type GmackoRpcClient = ReturnType<typeof createGmackoRpcClient>;

const RpcClientContext = createContext<GmackoRpcClient | null>(null);

export function RpcClientProvider({
  children,
  options,
}: {
  children: React.ReactNode;
  options: GmackoClientOptions;
}) {
  // Lazy init via useState — client constructed once per provider mount.
  // SSR-safe because createGmackoRpcClient doesn't touch window.
  const [client] = useState(() => createGmackoRpcClient(options));

  return (
    <RpcClientContext.Provider value={client}>
      {children}
    </RpcClientContext.Provider>
  );
}

export function useRpcClient(): GmackoRpcClient {
  const ctx = useContext(RpcClientContext);
  if (!ctx) {
    throw new Error("useRpcClient must be used within RpcClientProvider");
  }
  return ctx;
}
