import { fetch as expoFetch } from "expo/fetch";
import { createBobRpcClient } from "@gmacko/bob-client";
import { createBobQueryClient } from "@gmacko/bob-client/query";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "@bob/api";

import { authClient } from "./auth";
import { getMobileAuthHeaders } from "./auth-headers";
import { getBaseUrl } from "./base-url";
import { isDevAuthBypassEnabled } from "./dev-auth-bypass";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ...
    },
  },
});

/**
 * A set of typesafe hooks for consuming your API.
 */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: createTRPCClient({
    links: [
      loggerLink({
        enabled: (opts) =>
          process.env.NODE_ENV === "development" ||
          (opts.direction === "down" && opts.result instanceof Error),
        colorMode: "ansi",
      }),
      httpBatchLink({
        transformer: superjson,
        url: `${getBaseUrl()}/api/trpc`,
        headers() {
          const headers = new Map<string, string>();
          headers.set("x-trpc-source", "expo-react");

          const cookies = authClient.getCookie();
          for (const [name, value] of Object.entries(
            getMobileAuthHeaders(cookies, isDevAuthBypassEnabled()),
          )) {
            headers.set(name, value);
          }
          return headers;
        },
      }),
    ],
  }),
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@bob/api";

export function createMobileBobRpcClient() {
  return createBobRpcClient({
    baseURL: `${getBaseUrl()}/api/rpc`,
    // Expo provides the streaming Response body required by Effect NDJSON.
    fetch: expoFetch as typeof fetch,
    headers: () => ({
      "x-rpc-source": "expo-react",
      ...getMobileAuthHeaders(authClient.getCookie(), isDevAuthBypassEnabled()),
    }),
  });
}

export const rpc = createBobQueryClient({
  baseURL: `${getBaseUrl()}/api/rpc`,
  // Expo provides the streaming Response body required by Effect NDJSON.
  fetch: expoFetch as typeof fetch,
  headers: () => ({
    "x-rpc-source": "expo-react",
    ...getMobileAuthHeaders(authClient.getCookie(), isDevAuthBypassEnabled()),
  }),
});
