import { ForgeDetector } from "./forge-detector.js";
import { RepoScanner, DiscoveredRepo } from "./repo-scanner.js";
import { HeartbeatSender, HeartbeatPayload } from "./heartbeat-sender.js";

export interface DiscoveryNotice {
  type: "forge_not_detected" | "forge_not_authenticated" | "dev_dir_missing";
  message: string;
  dismissable: boolean;
}

export interface DiscoveryState {
  forgeAvailable: boolean;
  forgeAuthenticated: boolean;
  repos: DiscoveredRepo[];
  notices: DiscoveryNotice[];
}

interface DiscoveryLoopConfig {
  devDir: string;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  agentTypes: string[];
  intervalMs?: number;
}

export class DiscoveryLoop {
  private forgeDetector: ForgeDetector;
  private repoScanner: RepoScanner;
  private heartbeatSender: HeartbeatSender;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: DiscoveryState;

  constructor(private config: DiscoveryLoopConfig) {
    this.forgeDetector = new ForgeDetector();
    this.repoScanner = new RepoScanner(config.devDir);
    this.heartbeatSender = new HeartbeatSender({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      workspaceId: config.workspaceId,
    });
    this.state = {
      forgeAvailable: false,
      forgeAuthenticated: false,
      repos: [],
      notices: [],
    };
  }

  async start(): Promise<DiscoveryState> {
    // Initial detection
    const notices: DiscoveryNotice[] = [];

    if (!this.forgeDetector.isAvailable()) {
      notices.push({
        type: "forge_not_detected",
        message: "ForgeGraph CLI not detected. Some features (app registration, build pipelines) are unavailable. Install forge CLI to enable full functionality.",
        dismissable: true,
      });
    } else if (!this.forgeDetector.isAuthenticated()) {
      notices.push({
        type: "forge_not_authenticated",
        message: "ForgeGraph CLI found but not authenticated. Run 'forge auth login' to enable ForgeGraph features.",
        dismissable: true,
      });
    } else {
      // Authenticated — cache app list
      this.forgeDetector.listApps();
    }

    this.state.forgeAvailable = this.forgeDetector.isAvailable();
    this.state.forgeAuthenticated = this.forgeDetector.isAuthenticated();
    this.state.notices = notices;

    // Initial scan + heartbeat
    await this.tick();

    // Start the loop
    const interval = this.config.intervalMs ?? 30_000;
    this.timer = setInterval(() => this.tick(), interval);

    console.log(`[DiscoveryLoop] Started (interval: ${interval}ms, devDir: ${this.config.devDir}, forge: ${this.state.forgeAvailable ? "yes" : "no"})`);
    return this.state;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): DiscoveryState {
    return this.state;
  }

  private async tick(): Promise<void> {
    // Scan repos
    const repos = this.repoScanner.scan();

    // Enrich with forge app IDs if forge is available
    if (this.state.forgeAvailable && this.state.forgeAuthenticated) {
      // Refresh app list periodically (listApps caches internally)
      this.forgeDetector.listApps();

      for (const repo of repos) {
        if (repo.isGit && repo.remoteUrl) {
          const app = this.forgeDetector.findAppByRemoteUrl(repo.remoteUrl);
          if (app) {
            repo.forgeAppId = app.id;
          }
        }
      }
    }

    this.state.repos = repos;

    // Send heartbeat
    await this.heartbeatSender.send({
      agentTypes: this.config.agentTypes,
      forgeAvailable: this.state.forgeAvailable,
      repos,
    });
  }
}
