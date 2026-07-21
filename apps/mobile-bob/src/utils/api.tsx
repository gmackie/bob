import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { createBobRpcClient } from "@gmacko/bob-client";
import superjson from "superjson";

import type { AppRouter } from "@bob/api";

import { authClient } from "./auth";
import { getMobileAuthHeaders } from "./auth-headers";
import { isDevAuthBypassEnabled } from "./dev-auth-bypass";
import { getBaseUrl } from "./base-url";

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
  const cookies = authClient.getCookie();
  const authHeaders = getMobileAuthHeaders(cookies, isDevAuthBypassEnabled());
  return createBobRpcClient({
    baseURL: `${getBaseUrl()}/api/rpc`,
    headers: {
      "x-rpc-source": "expo-react",
      ...authHeaders,
    },
  });
}
