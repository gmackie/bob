import { createOodaV1Client } from "./v1";

export * from "./v1";

/**
 * Compatibility entry point for the canonical, contract-typed OODA V1 client.
 * New consumers may import `createOodaV1Client` directly when they need the
 * asynchronous header provider or a custom fetch implementation.
 */
export function createOodaClient(baseUrl = "https://ooda.blder.bot") {
  return createOodaV1Client({ baseUrl });
}
