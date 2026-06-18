import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import SuperJSON from "superjson";

import { env } from "~/config/env";
import { authClient } from "~/utils/auth";

export interface VaultFile {
  relativePath: string;
  name: string;
  content: string;
  frontmatter: Record<string, unknown> | null;
}

interface VaultClient {
  vault: {
    list: {
      query: (input: {
        vaultKind: "personal" | "research";
        glob?: string;
      }) => Promise<string[]>;
    };
    read: {
      query: (input: {
        vaultKind: "personal" | "research";
        filePath: string;
      }) => Promise<VaultFile>;
    };
  };
}

function createVaultClient(baseUrl: string): VaultClient {
  const client = createTRPCClient<AnyRouter>({
    links: [
      httpBatchLink({
        transformer: SuperJSON,
        url: `${baseUrl.replace(/\/$/, "")}/api/trpc`,
        headers() {
          const headers = new Map<string, string>();
          headers.set("x-trpc-source", "mobile-bob");
          const cookies = authClient.getCookie();
          if (cookies) headers.set("Cookie", cookies);
          return headers;
        },
      }),
    ],
  });

  return client as unknown as VaultClient;
}

export type VaultKind = "personal" | "research";

export interface VaultBrowserHook {
  files: string[];
  isLoadingFiles: boolean;
  selectedFile: VaultFile | null;
  isLoadingFile: boolean;
  vaultKind: VaultKind;
  setVaultKind: (kind: VaultKind) => void;
  selectFile: (path: string) => void;
  clearSelection: () => void;
  error: string | null;
}

export function useVaultBrowser(): VaultBrowserHook {
  const baseUrl = env.oodaApiUrl;
  const client = useMemo(() => createVaultClient(baseUrl), [baseUrl]);
  const [vaultKind, setVaultKind] = useState<VaultKind>("personal");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ["mobile-bob", "vault", "list", vaultKind],
    queryFn: () => client.vault.list.query({ vaultKind, glob: "notes/**" }),
  });

  const fileQuery = useQuery({
    queryKey: ["mobile-bob", "vault", "read", vaultKind, selectedPath],
    enabled: Boolean(selectedPath),
    queryFn: () =>
      client.vault.read.query({
        vaultKind,
        filePath: selectedPath!,
      }),
  });

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPath(null);
  }, []);

  return {
    files: filesQuery.data ?? [],
    isLoadingFiles: filesQuery.isLoading,
    selectedFile: fileQuery.data ?? null,
    isLoadingFile: fileQuery.isLoading,
    vaultKind,
    setVaultKind,
    selectFile,
    clearSelection,
    error: filesQuery.error?.message ?? fileQuery.error?.message ?? null,
  };
}
