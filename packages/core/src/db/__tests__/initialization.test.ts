import { describe, expect, it } from "vitest";
import { readDatabaseConfig, createDatabaseConnection } from "../client";
import { createDatabaseManager } from "../migrate";

describe("database initialization", () => {
  it("rejects unknown drivers and missing or invalid postgres URLs", () => {
    expect(readDatabaseConfig({ PGLITE_DATA_DIR: "memory://" })).toEqual({
      driver: "pglite",
      dataDir: "memory://",
    });
    expect(() => readDatabaseConfig({ GMACKO_DB_DRIVER: "postgre" })).toThrow(
      "GMACKO_DB_DRIVER",
    );
    expect(() =>
      readDatabaseConfig({ GMACKO_DB_DRIVER: "postgres" }),
    ).toThrow();
    expect(() =>
      readDatabaseConfig({
        GMACKO_DB_DRIVER: "postgres",
        DATABASE_URL: "file:test",
      }),
    ).toThrow();
  });
  it("shares initialization and retries a failed migration after closing its connection", async () => {
    let calls = 0;
    const connections: Awaited<ReturnType<typeof createDatabaseConnection>>[] =
      [];
    const manager = createDatabaseManager(
      { driver: "pglite", dataDir: "memory://" },
      {
        connect: async (config) => {
          const c = await createDatabaseConnection(config);
          connections.push(c);
          return c;
        },
        migrate: async () => {
          calls++;
          if (calls === 1) throw new Error("fixture migration failed");
        },
      },
    );
    const first = manager.get();
    expect(manager.get()).toBe(first);
    await expect(first).rejects.toThrow("fixture migration failed");
    const db = await manager.get();
    expect(await manager.get()).toBe(db);
    expect(calls).toBe(2);
    expect((connections[0]!.client as { closed: boolean }).closed).toBe(true);
    const closing = manager.close();
    const reopening = manager.get();
    await closing;
    expect((connections[1]!.client as { closed: boolean }).closed).toBe(true);
    expect(await reopening).not.toBe(db);
    await manager.close();
  });
});
