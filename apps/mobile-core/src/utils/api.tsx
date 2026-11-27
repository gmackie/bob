import { fetch as expoFetch } from "expo/fetch";
import { QueryClient } from "@tanstack/react-query";
import { getBaseUrl } from "./base-url";
import { createThreadRpc } from "./thread-rpc";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});
export const rpc = createThreadRpc(`${getBaseUrl()}/rpc`, expoFetch);
