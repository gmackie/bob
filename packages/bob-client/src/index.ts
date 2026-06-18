import createClient from "openapi-fetch";

// TODO: Once openapi-typescript generates schema.d.ts from dist/openapi/bob.json,
// import the paths type and pass it as the generic parameter:
//   import type { paths } from "../schema";
//   export function createBobClient(baseUrl = "https://bob.blder.bot") {
//     return createClient<paths>({ baseUrl });
//   }

/**
 * Create an HTTP client for the Bob API.
 *
 * Currently untyped — run `openapi-typescript dist/openapi/bob.json -o
 * packages/bob-client/schema.d.ts` and add the `paths` generic to get
 * full request/response types.
 */
export function createBobClient(baseUrl = "https://bob.blder.bot") {
  return createClient({ baseUrl });
}
