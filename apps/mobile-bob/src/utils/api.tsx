import { fetch as expoFetch } from "expo/fetch";
import { createBobRpcClient } from "@gmacko/bob-client";
import { createBobQueryClient } from "@gmacko/bob-client/query";
import { QueryClient } from "@tanstack/react-query";

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

export function createMobileBobRpcClient() {
  return createBobRpcClient({
    baseURL: `${getBaseUrl()}/api/rpc`,
    // Expo provides the streaming Response body required by Effect NDJSON.
    fetch: expoFetch,
    headers: () => ({
      "x-rpc-source": "expo-react",
      ...getMobileAuthHeaders(authClient.getCookie(), isDevAuthBypassEnabled()),
    }),
  });
}

export const rpc = createBobQueryClient({
  baseURL: `${getBaseUrl()}/api/rpc`,
  // Expo provides the streaming Response body required by Effect NDJSON.
  fetch: expoFetch,
  headers: () => ({
    "x-rpc-source": "expo-react",
    ...getMobileAuthHeaders(authClient.getCookie(), isDevAuthBypassEnabled()),
  }),
});
