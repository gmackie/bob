// Single-use tickets that let an MCP Apps view open the SDLC edge socket. The
// view runs in a sandboxed iframe with an opaque origin, so it has neither the
// session cookie nor a way to set an Authorization header; it gets a ticket
// from bob_sdlc_connect and puts it in the socket URL instead.
import { digest, randomToken } from "./oauth";
import type { OAuthGrant, OAuthStore } from "./types";

const KIND = "sdlc_ticket";
export const SDLC_TICKET_SECONDS = 60;

export async function issueSdlcTicket(
  store: Pick<OAuthStore, "addCredential">,
  grant: OAuthGrant,
): Promise<string> {
  const ticket = randomToken();
  await store.addCredential({
    hash: await digest(ticket),
    kind: KIND,
    grantId: grant.id,
    data: { userId: grant.userId },
    expiresAt: new Date(Date.now() + SDLC_TICKET_SECONDS * 1000),
    usedAt: null,
  });
  return ticket;
}

/** The ticket's user, once: a used, expired or unknown ticket gives null. */
export async function consumeSdlcTicket(
  store: Pick<OAuthStore, "consume" | "grant">,
  ticket: string,
): Promise<string | null> {
  if (!ticket) return null;
  const credential = await store.consume(await digest(ticket));
  if (!credential || credential.kind !== KIND || credential.expiresAt <= new Date())
    return null;
  // A revoked or expired grant takes its unspent tickets with it.
  const grant = credential.grantId ? await store.grant(credential.grantId) : undefined;
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) return null;
  const userId = credential.data.userId;
  return typeof userId === "string" ? userId : null;
}
