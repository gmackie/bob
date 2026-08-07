import { signEnvelope, readSessionCookieValue } from "~/lib/sso";

// GET /api/sso/handoff?r=<return url> — mint side of the cross-domain SSO.
// Called on ooda.blder.bot (which holds the .blder.bot session). Reads the
// current session token, wraps it in a signed envelope, and redirects to
// ooda.gmac.io/api/sso/accept. If there is no session here, redirects back with
// ?sso=none so gmac.io stops retrying and shows the "log in" notice instead.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawReturn = url.searchParams.get("r") ?? "https://ooda.gmac.io/oracle";
  // Only ever return to the gmac.io alias.
  let returnUrl: URL;
  try {
    returnUrl = new URL(rawReturn, "https://ooda.gmac.io");
    if (returnUrl.hostname !== "ooda.gmac.io") {
      returnUrl = new URL("https://ooda.gmac.io/oracle");
    }
  } catch {
    returnUrl = new URL("https://ooda.gmac.io/oracle");
  }

  const secret = process.env.AUTH_SECRET ?? "";
  const sessionValue = readSessionCookieValue(request.headers.get("cookie") ?? "");

  const accept = new URL("https://ooda.gmac.io/api/sso/accept");
  accept.searchParams.set("r", returnUrl.toString());

  if (sessionValue && secret) {
    accept.searchParams.set("t", await signEnvelope(sessionValue, secret));
  } else {
    // Not logged in on blder.bot either → don't hand off a token.
    accept.searchParams.set("sso", "none");
  }

  return Response.redirect(accept.toString(), 302);
}
