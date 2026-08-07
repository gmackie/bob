import { verifyEnvelope, SESSION_COOKIE } from "~/lib/sso";

// GET /api/sso/accept?t=<envelope>&r=<return url> — accept side of the SSO.
// Runs on ooda.gmac.io. Verifies the HMAC envelope minted by ooda.blder.bot and
// sets a .gmac.io session cookie carrying the same signed better-auth token, so
// getSession authenticates this domain against the shared session DB. A missing
// or invalid/expired envelope just returns to the page with ?sso=none (no
// cookie set) — the client then shows the login notice instead of looping.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawReturn = url.searchParams.get("r") ?? "/oracle";
  let redirectTo: URL;
  try {
    redirectTo = new URL(rawReturn, "https://ooda.gmac.io");
    if (redirectTo.hostname !== "ooda.gmac.io") {
      redirectTo = new URL("https://ooda.gmac.io/oracle");
    }
  } catch {
    redirectTo = new URL("https://ooda.gmac.io/oracle");
  }

  const token = url.searchParams.get("t");
  const secret = process.env.AUTH_SECRET ?? "";
  const value = token && secret ? await verifyEnvelope(token, secret) : null;

  if (!value) {
    redirectTo.searchParams.set("sso", "none");
    return Response.redirect(redirectTo.toString(), 302);
  }

  // Clear any prior ?sso=none marker on success.
  redirectTo.searchParams.delete("sso");

  const cookie =
    `${SESSION_COOKIE}=${value}; Domain=.gmac.io; Path=/; Secure; HttpOnly; ` +
    `SameSite=Lax; Max-Age=604800`;

  return new Response(null, {
    status: 302,
    headers: { "Set-Cookie": cookie, Location: redirectTo.toString() },
  });
}
