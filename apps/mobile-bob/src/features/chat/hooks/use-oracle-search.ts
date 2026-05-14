import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import SuperJSON from "superjson";

import { env } from "~/config/env";
import { authClient } from "~/utils/auth";

export interface OracleChunk {
  unitId: string;
  sourceId: number;
  content: string;
  tokenCount: number;
  headingContext: string | null;
  score: number;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceKind: string;
}

interface OracleQueryResult {
  chunks: OracleChunk[];
  confidence: number;
  queryId: string;
  latencyMs: number;
}

interface OracleClient {
  oracle: {
    query: {
      query: (input: {
        task: string;
        question: string;
        topK?: number;
      }) => Promise<OracleQueryResult>;
    };
  };
}

function createOracleClient(baseUrl: string): OracleClient {
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

  return client as unknown as OracleClient;
}

export interface OracleSearchHook {
  search: (query: string) => void;
  results: OracleChunk[];
  isSearching: boolean;
  lastQuery: string | null;
  latencyMs: number | null;
  error: string | null;
  clear: () => void;
}

export function useOracleSearch(): OracleSearchHook {
  const baseUrl = env.oodaApiUrl;
  const client = useMemo(() => createOracleClient(baseUrl), [baseUrl]);
  const [results, setResults] = useState<OracleChunk[]>([]);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (query: string) =>
      client.oracle.query.query({
        task: "mobile knowledge search",
        question: query,
        topK: 8,
      }),
    onSuccess: (data) => {
      setResults(data.chunks);
      setLatencyMs(data.latencyMs);
    },
  });

  const search = useCallback(
    (query: string) => {
      setLastQuery(query);
      setResults([]);
      setLatencyMs(null);
      mutation.mutate(query);
    },
    [mutation],
  );

  const clear = useCallback(() => {
    setResults([]);
    setLastQuery(null);
    setLatencyMs(null);
  }, []);

  return {
    search,
    results,
    isSearching: mutation.isPending,
    lastQuery,
    latencyMs,
    error: mutation.error?.message ?? null,
    clear,
  };
}
