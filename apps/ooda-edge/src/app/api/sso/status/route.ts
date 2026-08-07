import { getAuth } from "~/auth/server";

// GET /api/sso/status — { authed: boolean } for the current request cookies.
// The client on ooda.gmac.io uses this to decide whether to trigger the SSO
// handoff, show the login notice, or do nothing. Validates the session token
// against the shared DB via better-auth (domain-agnostic).
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    return Response.json({ authed: Boolean(session?.session) });
  } catch {
    return Response.json({ authed: false });
  }
}
