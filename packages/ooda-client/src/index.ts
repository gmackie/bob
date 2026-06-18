import createClient from "openapi-fetch";

// TODO: Once openapi-typescript generates schema.d.ts from dist/openapi/ooda.json,
// import the paths type and pass it as the generic parameter:
//   import type { paths } from "../schema";
//   export function createOodaClient(baseUrl = "https://ooda.blder.bot") {
//     return createClient<paths>({ baseUrl });
//   }

/**
 * Create an HTTP client for the OODA Research API.
 *
 * Currently untyped — run `openapi-typescript dist/openapi/ooda.json -o
 * packages/ooda-client/schema.d.ts` and add the `paths` generic to get
 * full request/response types.
 */
export function createOodaClient(baseUrl = "https://ooda.blder.bot") {
  return createClient({ baseUrl });
}
