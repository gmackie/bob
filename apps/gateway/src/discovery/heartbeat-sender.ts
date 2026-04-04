import { DiscoveredRepo } from "./repo-scanner.js";

export interface HeartbeatPayload {
  agentTypes: string[];
  forgeAvailable: boolean;
  repos: DiscoveredRepo[];
}

interface HeartbeatConfig {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}

export class HeartbeatSender {
  constructor(private config: HeartbeatConfig) {}

  async send(payload: HeartbeatPayload): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/workspaces/${this.config.workspaceId}/heartbeat`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[HeartbeatSender] API returned ${res.status}: ${text}`);
      }
    } catch (err) {
      console.warn(`[HeartbeatSender] Failed to send heartbeat:`, err);
    }
  }
}
