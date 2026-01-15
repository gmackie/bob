import { EventEmitter } from 'events';

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelInfo {
  status: TunnelStatus;
  publicUrl?: string;
  localPort: number;
  startedAt?: Date;
  error?: string;
}

interface NgrokListener {
  url(): string;
  close(): Promise<void>;
}

type NgrokModule = {
  forward(options: Record<string, unknown>): Promise<NgrokListener>;
};

export class TunnelService extends EventEmitter {
  private listener: NgrokListener | null = null;
  private status: TunnelStatus = 'stopped';
  private publicUrl: string | null = null;
  private startedAt: Date | null = null;
  private error: string | null = null;
  private localPort: number;
  private ngrokAvailable: boolean | null = null;
  private ngrokModule: NgrokModule | null = null;

  constructor(localPort: number = 3001) {
    super();
    this.localPort = localPort;
  }

  private async checkNgrokAvailable(): Promise<boolean> {
    if (this.ngrokAvailable !== null) {
      return this.ngrokAvailable;
    }

    try {
      // @ts-ignore - @ngrok/ngrok is an optional dependency
      this.ngrokModule = await import('@ngrok/ngrok') as unknown as NgrokModule;
      this.ngrokAvailable = true;
    } catch {
      this.ngrokAvailable = false;
      this.ngrokModule = null;
    }

    return this.ngrokAvailable;
  }

  async start(options: { 
    authtoken?: string; 
    domain?: string;
  } = {}): Promise<TunnelInfo> {
    if (this.status === 'running') {
      return this.getStatus();
    }

    const isAvailable = await this.checkNgrokAvailable();
    if (!isAvailable) {
      this.status = 'error';
      this.error = 'ngrok SDK not installed. Install with: npm install @ngrok/ngrok';
      return this.getStatus();
    }

    this.status = 'starting';
    this.error = null;
    this.emit('status', this.getStatus());

    try {
      // @ts-ignore - @ngrok/ngrok is an optional dependency
      const ngrok = await import('@ngrok/ngrok') as NgrokModule;
      
      const forwardOptions: Record<string, unknown> = {
        addr: this.localPort,
        authtoken_from_env: !options.authtoken,
      };

      if (options.authtoken) {
        forwardOptions.authtoken = options.authtoken;
      }

      if (options.domain) {
        forwardOptions.domain = options.domain;
      }

      this.listener = await ngrok.forward(forwardOptions);
      this.publicUrl = this.listener!.url();
      this.status = 'running';
      this.startedAt = new Date();
      this.error = null;

      console.log(`Tunnel established: ${this.publicUrl} -> localhost:${this.localPort}`);
      this.emit('status', this.getStatus());

      return this.getStatus();
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.listener = null;
      this.publicUrl = null;
      this.startedAt = null;

      console.error('Failed to start tunnel:', this.error);
      this.emit('status', this.getStatus());

      return this.getStatus();
    }
  }

  async stop(): Promise<TunnelInfo> {
    if (this.status === 'stopped' || !this.listener) {
      this.status = 'stopped';
      return this.getStatus();
    }

    try {
      await this.listener.close();
      console.log('Tunnel closed');
    } catch (err) {
      console.error('Error closing tunnel:', err);
    }

    this.listener = null;
    this.publicUrl = null;
    this.startedAt = null;
    this.status = 'stopped';
    this.error = null;

    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  getStatus(): TunnelInfo {
    return {
      status: this.status,
      publicUrl: this.publicUrl || undefined,
      localPort: this.localPort,
      startedAt: this.startedAt || undefined,
      error: this.error || undefined,
    };
  }

  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  isRunning(): boolean {
    return this.status === 'running' && this.listener !== null;
  }

  async isNgrokAvailable(): Promise<boolean> {
    return this.checkNgrokAvailable();
  }

  getCallbackUrl(path: string): string | null {
    if (!this.publicUrl) return null;
    const base = this.publicUrl.endsWith('/') ? this.publicUrl.slice(0, -1) : this.publicUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
}

export const tunnelService = new TunnelService(
  parseInt(process.env.PORT || '3001', 10)
);
