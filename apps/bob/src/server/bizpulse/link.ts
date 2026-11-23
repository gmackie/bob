import { and, eq, gt, lt } from "@bob/db";
import { db } from "@bob/db/client";
import {
  bizpulseMcpConsent,
  bizpulseMcpLink,
  workspaces,
} from "@bob/db/schema";
import {
  decryptToken,
  encryptToken,
} from "@bob/api/services/crypto/tokenVault";

import {
  createAuthorization,
  discover,
  exchange,
  InvalidBizPulseGrant,
  revoke,
  savedToken,
  stateDigest,
} from "./client";
import type { BizPulseConfig } from "./client";

const linkId = (userId: string, workspaceId: string) =>
  JSON.stringify(["bizpulse", userId, workspaceId]);
export async function ownsBobWorkspace(userId: string, workspaceId: string) {
  const [owned] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.ownerUserId, userId), eq(workspaces.id, workspaceId)),
    );
  return Boolean(owned);
}

export async function beginBizPulseLink(
  config: BizPulseConfig,
  userId: string,
  workspaceId: string,
) {
  if (!(await ownsBobWorkspace(userId, workspaceId)))
    throw new Error("Workspace denied");
  const metadata = await discover(config);
  const { state, verifier, url } = createAuthorization(
    config,
    metadata.authorization_endpoint,
  );
  const stateHash = stateDigest(state);
  await db
    .delete(bizpulseMcpConsent)
    .where(
      and(
        eq(bizpulseMcpConsent.userId, userId),
        lt(bizpulseMcpConsent.expiresAt, new Date()),
      ),
    );
  await db.insert(bizpulseMcpConsent).values({
    stateHash,
    userId,
    workspaceId,
    origin: config.origin,
    envelope: encryptToken(verifier, stateHash),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return url;
}

export async function finishBizPulseLink(
  config: BizPulseConfig,
  userId: string,
  state: string,
  code?: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  const hash = stateDigest(state);
  const [consent] = await db
    .delete(bizpulseMcpConsent)
    .where(
      and(
        eq(bizpulseMcpConsent.stateHash, hash),
        eq(bizpulseMcpConsent.userId, userId),
        eq(bizpulseMcpConsent.origin, config.origin),
        gt(bizpulseMcpConsent.expiresAt, new Date()),
      ),
    )
    .returning();
  if (
    !consent ||
    !code ||
    !(await ownsBobWorkspace(userId, consent.workspaceId))
  )
    return false;
  const id = linkId(userId, consent.workspaceId);
  const pair = await exchange(config, {
    kind: "code",
    code,
    verifier: decryptToken(consent.envelope, hash),
  });
  try {
    await db.insert(bizpulseMcpLink).values({
      id,
      userId,
      workspaceId: consent.workspaceId,
      origin: config.origin,
      envelope: encryptToken(JSON.stringify(savedToken.parse(pair)), id),
      expiresAt: new Date(Date.now() + pair.expires_in * 1000),
    });
  } catch (error) {
    await revoke(config, pair.refresh_token);
    throw error;
  }
  return true;
}

export async function bizPulseAccess(
  config: BizPulseConfig,
  userId: string,
  workspaceId: string,
) {
  if (!(await ownsBobWorkspace(userId, workspaceId))) return null;
  const id = linkId(userId, workspaceId);
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(bizpulseMcpLink)
      .where(
        and(
          eq(bizpulseMcpLink.id, id),
          eq(bizpulseMcpLink.origin, config.origin),
        ),
      )
      .for("update");
    if (!link) return null;
    const stored = savedToken.parse(
      JSON.parse(decryptToken(link.envelope, id)),
    );
    if (link.expiresAt.getTime() > Date.now() + 30_000)
      return stored.access_token;
    try {
      const pair = await exchange(config, {
        kind: "refresh",
        refreshToken: stored.refresh_token,
      });
      await tx
        .update(bizpulseMcpLink)
        .set({
          envelope: encryptToken(JSON.stringify(savedToken.parse(pair)), id),
          expiresAt: new Date(Date.now() + pair.expires_in * 1000),
        })
        .where(eq(bizpulseMcpLink.id, id));
      return pair.access_token;
    } catch (error) {
      if (!(error instanceof InvalidBizPulseGrant)) throw error;
      await tx.delete(bizpulseMcpLink).where(eq(bizpulseMcpLink.id, id));
      return null;
    }
  });
}

export async function disconnectBizPulse(
  config: BizPulseConfig,
  userId: string,
  workspaceId: string,
) {
  const id = linkId(userId, workspaceId);
  await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(bizpulseMcpLink)
      .where(
        and(
          eq(bizpulseMcpLink.id, id),
          eq(bizpulseMcpLink.origin, config.origin),
        ),
      )
      .for("update");
    if (!link) return;
    const stored = savedToken.parse(
      JSON.parse(decryptToken(link.envelope, id)),
    );
    await revoke(config, stored.refresh_token);
    await tx.delete(bizpulseMcpLink).where(eq(bizpulseMcpLink.id, id));
  });
}
