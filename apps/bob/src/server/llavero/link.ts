import { and, eq, gt, isNull } from "@bob/db";
import { db } from "@bob/db/client";
import { llaveroMcpLink } from "@bob/db/schema";
import { decryptToken, encryptToken } from "@bob/api/services/crypto/tokenVault";

import { stateDigest } from "../bizpulse/client";
import { ownsBobWorkspace } from "../bizpulse/link";
import type { LlaveroConfig } from "./client";
import {
  checkLlaveroTools,
  exchangeLlavero,
  registerLlavero,
  revokeLlavero,
  savedLlaveroTokens,
} from "./client";

const linkId = (config: LlaveroConfig, userId: string, workspaceId: string) =>
  JSON.stringify(["llavero", config.origin, userId, workspaceId]);
const tokenContext = (link: { id: string; clientId: string }) =>
  JSON.stringify([link.id, link.clientId]);
const linkVersion = (link: { id: string; clientId: string }) =>
  and(eq(llaveroMcpLink.id, link.id), eq(llaveroMcpLink.clientId, link.clientId));

export async function beginLlaveroLink(
  config: LlaveroConfig,
  userId: string,
  workspaceId: string,
) {
  if (!(await ownsBobWorkspace(userId, workspaceId))) throw new Error("Workspace denied");
  const id = linkId(config, userId, workspaceId);
  const { state, verifier, clientId, url } = await registerLlavero(config);
  const stateHash = stateDigest(state);
  const fields = {
    clientId,
    stateHash,
    verifier: encryptToken(verifier, stateHash),
    consentExpiresAt: new Date(Date.now() + 10 * 60_000),
  };
  const [saved] = await db.insert(llaveroMcpLink)
    .values({ ...fields, id, userId, workspaceId, origin: config.origin })
    .onConflictDoUpdate({
      target: llaveroMcpLink.id,
      set: fields,
      setWhere: isNull(llaveroMcpLink.tokens),
    })
    .returning({ id: llaveroMcpLink.id });
  if (!saved) throw new Error("Disconnect Llavero before reconnecting");
  return url;
}

async function revoke(config: LlaveroConfig, clientId: string, refreshToken: string) {
  try {
    return await revokeLlavero(config, clientId, refreshToken);
  } catch {
    return false;
  }
}

async function saveTokens(
  config: LlaveroConfig,
  link: { id: string; clientId: string },
  pair: Awaited<ReturnType<typeof exchangeLlavero>>,
) {
  try {
    const [saved] = await db.update(llaveroMcpLink)
      .set({
        tokens: encryptToken(JSON.stringify(savedLlaveroTokens.parse(pair)), tokenContext(link)),
        expiresAt: new Date(Date.now() + pair.expires_in * 1000),
      })
      .where(and(linkVersion(link), isNull(llaveroMcpLink.expiresAt)))
      .returning({ id: llaveroMcpLink.id });
    if (saved) return;
  } catch {
    // A failed write cannot safely leave an untracked grant active.
  }
  await revoke(config, link.clientId, pair.refresh_token);
  throw new Error("Llavero connection changed");
}

export async function finishLlaveroLink(
  config: LlaveroConfig,
  userId: string,
  state: string,
  code?: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || (code && code.length > 4000)) return false;
  const hash = stateDigest(state);
  const [link] = await db.select().from(llaveroMcpLink).where(
    and(
      eq(llaveroMcpLink.stateHash, hash),
      eq(llaveroMcpLink.userId, userId),
      eq(llaveroMcpLink.origin, config.origin),
      gt(llaveroMcpLink.consentExpiresAt, new Date()),
    ),
  );
  if (!link?.verifier || !(await ownsBobWorkspace(userId, link.workspaceId))) return false;
  const [claimed] = await db.update(llaveroMcpLink)
    .set({ stateHash: null, verifier: null, consentExpiresAt: null })
    .where(and(linkVersion(link), eq(llaveroMcpLink.stateHash, hash)))
    .returning({ id: llaveroMcpLink.id });
  if (!claimed || !code) return false;
  const pair = await exchangeLlavero(config, link.clientId, {
    code,
    verifier: decryptToken(link.verifier, hash),
  });
  try {
    if (!(await checkLlaveroTools(config, pair.access_token)))
      throw new Error("Llavero rotation permissions are missing");
  } catch {
    await revoke(config, link.clientId, pair.refresh_token);
    return false;
  }
  await saveTokens(config, link, pair);
  return true;
}

export async function withLlaveroLink<T>(
  config: LlaveroConfig,
  userId: string,
  workspaceId: string,
  action: (token: string) => Promise<T>,
) {
  if (!(await ownsBobWorkspace(userId, workspaceId))) return null;
  const id = linkId(config, userId, workspaceId);
  const claim = await db.transaction(async (tx) => {
    const [link] = await tx.select().from(llaveroMcpLink)
      .where(eq(llaveroMcpLink.id, id)).for("update");
    if (!link?.tokens || !link.expiresAt) return null;
    const pair = savedLlaveroTokens.parse(JSON.parse(decryptToken(link.tokens, tokenContext(link))));
    if (link.expiresAt.getTime() > Date.now() + 30_000)
      return { link, pair, refresh: false };
    // Invalidate the local grant before a single-use refresh. Keep the
    // encrypted token for owner revocation if the exchange is interrupted.
    await tx.update(llaveroMcpLink).set({ expiresAt: null }).where(eq(llaveroMcpLink.id, id));
    return { link, pair, refresh: true };
  });
  if (!claim) return null;
  if (!claim.refresh) return action(claim.pair.access_token);
  const pair = await exchangeLlavero(config, claim.link.clientId, {
    refreshToken: claim.pair.refresh_token,
  });
  await saveTokens(config, claim.link, pair);
  return action(pair.access_token);
}

export async function verifyLlaveroLink(
  config: LlaveroConfig,
  userId: string,
  workspaceId: string,
) {
  return withLlaveroLink(config, userId, workspaceId, (token) =>
    checkLlaveroTools(config, token),
  );
}

export async function disconnectLlavero(
  config: LlaveroConfig,
  userId: string,
  workspaceId: string,
) {
  if (!(await ownsBobWorkspace(userId, workspaceId))) throw new Error("Workspace denied");
  const [link] = await db.delete(llaveroMcpLink)
    .where(eq(llaveroMcpLink.id, linkId(config, userId, workspaceId))).returning();
  if (!link?.tokens) return true;
  try {
    const pair = savedLlaveroTokens.parse(JSON.parse(decryptToken(link.tokens, tokenContext(link))));
    return revoke(config, link.clientId, pair.refresh_token);
  } catch {
    return false;
  }
}
