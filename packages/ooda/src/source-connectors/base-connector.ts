export interface ConnectorResult {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorConfig {
  timeoutMs: number;
  maxRetries: number;
  circuitBreakerThreshold: number;
  baseDelayMs?: number;
}

export abstract class BaseConnector {
  abstract id: string;
  abstract name: string;

  private failureCount = 0;
  private circuitOpen = false;
  private config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  protected abstract executeRequest(
    query: string,
  ): Promise<ConnectorResult[]>;

  async search(query: string): Promise<ConnectorResult[]> {
    if (this.circuitOpen) {
      throw new Error(
        `Circuit breaker open for connector ${this.id}. Try again later.`,
      );
    }

    let lastError: Error | undefined;
    const maxAttempts = 1 + this.config.maxRetries;
    const baseDelay = this.config.baseDelayMs ?? 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const results = await Promise.race([
          this.executeRequest(query),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Connector ${this.id} timed out after ${this.config.timeoutMs}ms`)),
              this.config.timeoutMs,
            ),
          ),
        ]);
        this.failureCount = 0;
        return results;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const statusCode = (err as { statusCode?: number }).statusCode;
        const isRateLimited = statusCode === 429 || statusCode === 403;
        const isRetryable = isRateLimited || !statusCode;

        if (!isRetryable || attempt === maxAttempts - 1) {
          this.recordFailure();
          break;
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.config.circuitBreakerThreshold) {
      this.circuitOpen = true;
      // Auto-reset after 60 seconds
      setTimeout(() => {
        this.circuitOpen = false;
        this.failureCount = 0;
      }, 60_000);
    }
  }
}
