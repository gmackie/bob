/**
 * Push the workspace owner when the inference proxy stops serving.
 *
 * The runner heartbeats every ~30s with the proxy's state inside the host
 * snapshot. Two of those states stop every run — the proxy unreachable, a
 * provider with no ready account — and each is worth exactly one push when it
 * begins: not one per heartbeat, and nothing on recovery, because the panel
 * going green is the message. This keeps the previous state per workspace and
 * pushes the diff, using the same model the Nodes page renders so a push never
 * disagrees with the screen.
 *
 * Delivery honours the owner's notification preferences through pushToUser's
 * type gate; the types default to push-on like a blocked agent.
 */

import type { HostSnapshotWire } from "./protocol.js";
import { deriveProxyAlertState, diffProxyAlerts, type ProxyAlertState } from "@bob/ws";

export interface ProxyAlertNotifierOptions {
  push: (
    userId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, unknown>;
      priority?: "high" | "default";
      type?: "proxy_unreachable" | "provider_no_ready_accounts";
    },
  ) => Promise<unknown>;
  ownerOf: (workspaceId: string) => Promise<string | null>;
  now?: () => Date;
}

export class ProxyAlertNotifier {
  private readonly previous = new Map<string, ProxyAlertState>();

  constructor(private readonly opts: ProxyAlertNotifierOptions) {}

  async observe(workspaceId: string, snapshot: HostSnapshotWire): Promise<void> {
    const now = this.opts.now?.() ?? new Date();
    const next = deriveProxyAlertState(snapshot, now);
    const alerts = diffProxyAlerts(this.previous.get(workspaceId), next);
    // Record first: a push that fails must not be retried on every heartbeat.
    this.previous.set(workspaceId, next);
    if (alerts.length === 0) return;

    const ownerId = await this.opts.ownerOf(workspaceId);
    if (!ownerId) return;

    for (const alert of alerts) {
      try {
        await this.opts.push(ownerId, {
          title: alert.title,
          body: alert.body,
          priority: "high",
          type: alert.type,
          data: {
            type: "proxy.alert",
            alert: alert.type,
            ...(alert.provider ? { provider: alert.provider } : {}),
            workspaceId,
            // The phone routes a tap by `url`; the web by `href`. Same place.
            href: "/nodes",
            url: "/nodes",
          },
        });
      } catch (error) {
        console.error(
          "[relay] proxy alert push failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
}
