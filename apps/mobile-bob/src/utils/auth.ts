import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  expoClient,
  getCookie as formatSessionCookie,
  storageAdapter,
} from "@better-auth/expo/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getAuthBaseUrl } from "~/config/env";
import {
  createDevAuthSession,
  getDevAuthBypassCookie,
  isDevAuthBypassEnabled,
} from "./dev-auth-bypass";
import { getMobileAuthScheme } from "./oauth";

const realAuthClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [
    magicLinkClient(),
    expoClient({
      scheme: getMobileAuthScheme(Constants.expoConfig?.scheme),
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

// better-auth 1.7 made `authClient.getCookie()` async. Request-header builders
// here are synchronous, so read the same (chunked) cookie record the expo
// plugin maintains through its sync storage path. `bob_cookie` is the plugin's
// `${storagePrefix}_cookie` key.
const sessionCookieStorage = storageAdapter(SecureStore);

/** The session cookie header value, read synchronously ("" when signed out). */
export function getSessionCookie(): string {
  if (isDevAuthBypassEnabled()) return getDevAuthBypassCookie();
  return formatSessionCookie(sessionCookieStorage.getItem("bob_cookie"));
}
