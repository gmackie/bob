import { and, eq, isNull } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  mcpOAuthClients as clients,
  mcpOAuthGrants as grants,
  mcpOAuthCredentials as credentials,
} from "@bob/db/schema";
import type { OAuthStore, OAuthTransaction } from "./types";

type Database = Pick<Db, "select" | "insert" | "update">;
function queries(db: Database): OAuthTransaction {
  return {
    client: async (id) =>
      (await db.select().from(clients).where(eq(clients.id, id)).limit(1))[0],
    addClient: async (client) => {
      await db.insert(clients).values(client);
    },
    grant: async (id) =>
      (await db.select().from(grants).where(eq(grants.id, id)).limit(1))[0],
    addGrant: async (grant) => {
      await db.insert(grants).values(grant);
    },
    revoke: async (id) => {
      await db
        .update(grants)
        .set({ revokedAt: new Date() })
        .where(eq(grants.id, id));
    },
    credential: async (hash) =>
      (
        await db
          .select()
          .from(credentials)
          .where(eq(credentials.hash, hash))
          .limit(1)
      )[0],
    addCredential: async (credential) => {
      await db.insert(credentials).values(credential);
    },
    // Conditional UPDATE is the cross-isolate one-time-use gate. Both credential
    // consumption and replacement insertion commit in the same DB transaction.
    consume: async (hash) =>
      (
        await db
          .update(credentials)
          .set({ usedAt: new Date() })
          .where(and(eq(credentials.hash, hash), isNull(credentials.usedAt)))
          .returning()
      )[0],
  };
}
export function makeOAuthStore(db: Db): OAuthStore {
  return {
    ...queries(db),
    transaction: (work) => db.transaction((tx) => work(queries(tx))),
  };
}
