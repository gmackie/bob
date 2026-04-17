import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

export type PgliteDbOptions = {
  /** `:memory:` for tests, or an absolute directory path for persistence. */
  dataDir?: string;
};

export type PgliteDbHandle = {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
};

const DEFAULT_DIR = path.join(os.homedir(), ".bob", "userdata", "db");

export async function makePgliteDb(options: PgliteDbOptions = {}): Promise<PgliteDbHandle> {
  const dataDir = options.dataDir ?? DEFAULT_DIR;

  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir === ":memory:" ? undefined : dataDir);
  await client.waitReady;

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
