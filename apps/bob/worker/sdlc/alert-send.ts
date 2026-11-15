import type { SdlcAlertDelivery } from "./alerts";

/**
 * How the SdlcEdge DO reaches Bob's notification path (BOB-81). The DO runs in the same
 * worker bundle and is given the worker's bindings, HYPERDRIVE included, so it opens a
 * Postgres client per alert batch over the Hyperdrive connection string (runWithDbClosing,
 * which ends the client afterwards: the DO, unlike a request, lives on) and calls
 * sendSdlcAlerts, which writes the inbox rows and pushes through createInAppNotification
 * with per-user preferences applied.
 *
 * The DO wraps the returned promise in ctx.waitUntil; nothing here is awaited by ingest.
 */
export interface AlertSendEnv { HYPERDRIVE?: { connectionString: string } }

export interface AlertSendDeps {
  connection: (env: AlertSendEnv) => { connectionString: string; isHyperdrive: boolean };
  runWithDb: <T>(url: string, isHyperdrive: boolean, fn: () => Promise<T>) => Promise<T>;
  send: (deliveries: readonly SdlcAlertDelivery[]) => Promise<number>;
}

const defaultDeps: AlertSendDeps = {
  connection: (env) => {
    const hyperdrive = env.HYPERDRIVE?.connectionString;
    if (hyperdrive) return { connectionString: hyperdrive, isHyperdrive: true };
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required when HYPERDRIVE is unavailable");
    return { connectionString: url, isHyperdrive: false };
  },
  // Loaded lazily so the DO's constructor (and node tests) never load a database module.
  // The closing variant: a DO outlives the batch, so its Postgres client is ended after each one.
  runWithDb: async (url, isHyperdrive, fn) => (await import("../../src/lib/db-client-lazy")).runWithDbClosing(url, isHyperdrive, fn),
  send: async (deliveries) => {
    const [{ db }, { sendSdlcAlerts }] = await Promise.all([
      import("@bob/db/client"),
      import("@bob/api/services/notifications/sdlcAlerts"),
    ]);
    return sendSdlcAlerts(db, deliveries);
  },
};

export async function sendAlertsThroughBob(env: AlertSendEnv, deliveries: readonly SdlcAlertDelivery[], deps: AlertSendDeps = defaultDeps): Promise<void> {
  if (deliveries.length === 0) return;
  try {
    const { connectionString, isHyperdrive } = deps.connection(env);
    const written = await deps.runWithDb(connectionString, isHyperdrive, () => deps.send(deliveries));
    console.log(JSON.stringify({ event: "sdlc_edge_alerts_sent", planned: deliveries.length, written }));
  } catch (error) {
    console.error(JSON.stringify({ event: "sdlc_edge_alerts_failed", planned: deliveries.length, error: error instanceof Error ? error.message : String(error) }));
  }
}
