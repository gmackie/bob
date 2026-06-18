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
        refetch: async () => ({ data: devSession }),
      }) as ReturnType<typeof realAuthClient.useSession>,
    signIn: {
      ...realAuthClient.signIn,
      social: async () => ({ data: null, error: null }),
    },
  };
}

export const authClient = isDevAuthBypassEnabled()
  ? createDevAuthClient()
  : realAuthClient;
