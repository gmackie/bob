import * as SecureStore from "expo-secure-store";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

import {
  createDevAuthSession,
  getDevAuthBypassCookie,
  isDevAuthBypassEnabled,
} from "./dev-auth-bypass";
import { getAuthBaseUrl } from "~/config/env";

const realAuthClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [
    expoClient({
      scheme: "bob",
      storagePrefix: "bob",
      storage: SecureStore,
    }),
  ],
});

function createDevAuthClient() {
  const devSession = createDevAuthSession();

  return {
    ...realAuthClient,
    getCookie: () => getDevAuthBypassCookie(),
    useSession: () =>
      ({
        data: devSession,
        error: null,
        isPending: false,
        isRefetching: false,
        // Real better-auth `refetch` is `(queryParams?) => void` — fire and
        // forget, it re-triggers an internal fetch rather than returning a
        // promise the caller awaits. The dev session never changes, so
        // there's nothing to actually refetch.
        refetch: () => {
          /* no-op: dev auth bypass session is static */
        },
      }) as ReturnType<typeof realAuthClient.useSession>,
    signIn: {
      ...realAuthClient.signIn,
      social: () => Promise.resolve({ data: null, error: null }),
    },
  };
}

export const authClient = isDevAuthBypassEnabled()
  ? createDevAuthClient()
  : realAuthClient;
