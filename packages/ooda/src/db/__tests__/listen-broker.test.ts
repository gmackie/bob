import { describe, expect, it } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DATABASE_URL);

describe.skipIf(!HAS_DB)("ListenBroker", () => {
  it("fans out NOTIFY to multiple subscribers", async () => {
    const { ListenBroker } = await import("../listen-broker");
    const broker = new ListenBroker(DATABASE_URL!);

    const received1: string[] = [];
    const received2: string[] = [];

    const unsub1 = await broker.subscribe("test_broker_channel", (payload) => {
      received1.push(payload);
    });
    const unsub2 = await broker.subscribe("test_broker_channel", (payload) => {
      received2.push(payload);
    });

    const sql = postgres(DATABASE_URL!, { max: 1 });
    await sql`SELECT pg_notify('test_broker_channel', '{"hello":"world"}')`;
    await sql.end({ timeout: 2 });

    await new Promise((r) => setTimeout(r, 200));

    expect(received1).toEqual(['{"hello":"world"}']);
    expect(received2).toEqual(['{"hello":"world"}']);

    unsub1();
    unsub2();
    await broker.close();
  });

  it("cleans up channel when last subscriber leaves", async () => {
    const { ListenBroker } = await import("../listen-broker");
    const broker = new ListenBroker(DATABASE_URL!);

    const unsub = await broker.subscribe("test_cleanup_channel", () => {});
    unsub();

    expect(broker.channelCount).toBe(0);
    await broker.close();
  });
});
