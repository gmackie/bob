"use client";

import { useQuery } from "@tanstack/react-query";

import { useRpcClient } from "./rpc-client-provider";

/**
 * Identity provider — currently a pass-through. Auth state lives in TanStack
 * Query's cache, queried via `useCurrentUser()`. Component exists for API
 * symmetry (so consumers always have a Provider to render).
 */
export function CurrentUserProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

/**
 * Read the current user from the cached `auth.whoAmI` query. Returns the
 * full TanStack `UseQueryResult` shape — callers can pattern-match on
 * `isLoading` / `data` / `error` for fine-grained UI states.
 */
export function useCurrentUser() {
  const client = useRpcClient();
  return useQuery({
    queryKey: ["currentUser", "whoAmI"],
    queryFn: () => client.auth.whoAmI(),
    retry: false,
    staleTime: 30_000,
  });
}
