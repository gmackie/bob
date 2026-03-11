import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState, useMemo, type ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "@linear-clone/api";
import { useAuth } from "./auth";
import { useEnvironment } from "./environment";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const { config, environment } = useEnvironment();
  const [queryClient] = useState(() => new QueryClient());
  
  const trpcClient = useMemo(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${config.apiUrl}/api/trpc`,
          transformer: superjson,
          async headers() {
            if (!config.authRequired) {
              console.log("[TRPC] Using beta bypass header");
              return { "x-beta-auth-bypass": "true" };
            }
            const token = await getToken();
            console.log("[TRPC] Auth header, token present:", !!token);
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
    [config.apiUrl, config.authRequired, getToken, environment]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
