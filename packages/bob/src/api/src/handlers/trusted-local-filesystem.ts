import { timingSafeEqual } from "node:crypto";
import type { LocalFilesystemCapability } from "./context";

export const LOCAL_OPERATOR_HEADER = "x-bob-local-operator";
export interface TrustedLocalFilesystem {
  readonly proxySecret: string;
  readonly roots: readonly string[];
}

/** A capability grant, never an authentication shortcut. The principal must
 * already have been resolved by BetterAuth/API-key middleware. */
export function resolveTrustedLocalFilesystem(
  config: TrustedLocalFilesystem | undefined,
  userId: string | undefined,
  headers: Headers | Readonly<Record<string, string | undefined>>,
): LocalFilesystemCapability | undefined {
  if (!config || !userId || !config.roots.length || !config.proxySecret) return undefined;
  const received = headers instanceof Headers ? headers.get(LOCAL_OPERATOR_HEADER) : headers[LOCAL_OPERATOR_HEADER];
  if (!received) return undefined;
  const a = Buffer.from(received);
  const b = Buffer.from(config.proxySecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return { kind: "local-operator", userId, roots: config.roots };
}

export function readTrustedLocalFilesystemConfig(env: Record<string, string | undefined>): TrustedLocalFilesystem | undefined {
  if (env.BOB_BUILD_TARGET !== "node" || !env.BOB_LOCAL_OPERATOR_PROXY_SECRET) return undefined;
  const roots: unknown = JSON.parse(env.BOB_LOCAL_OPERATOR_ROOTS ?? "[]");
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string" || !root.trim())) {
    throw new Error("Local filesystem roots must be an explicit array of paths");
  }
  return { proxySecret: env.BOB_LOCAL_OPERATOR_PROXY_SECRET, roots: roots as string[] };
}
