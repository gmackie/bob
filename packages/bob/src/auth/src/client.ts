import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

export function createBobAuthClient(options?: { baseURL?: string }) {
  return createAuthClient({
    baseURL: options?.baseURL,
  });
}

export function createBobExpoAuthClient(options: {
  baseURL: string;
  scheme: string;
  storage: any;
  storagePrefix: string;
}) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [
      expoClient({
        scheme: options.scheme,
        storage: options.storage,
        storagePrefix: options.storagePrefix,
      }),
    ],
  });
}
