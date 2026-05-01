export type ConnectorStatus = "up" | "degraded" | "down" | "unknown";

export interface ConnectorHealth {
  connectorId: string;
  status: ConnectorStatus;
  rateLimitRemaining?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  errorCount: number;
  avgResponseMs?: number;
}

export interface InvocationRecord {
  status: number;
  durationMs: number;
  rateLimitRemaining?: number;
}

export interface FailureRecord {
  status: number;
  error: string;
}

const RATE_LIMIT_WARNING_THRESHOLD = 5;
const FAILURE_THRESHOLD = 3;

export class HealthTracker {
  private state = new Map<
    string,
    {
      errorCount: number;
      lastSuccessAt?: string;
      lastFailureAt?: string;
      rateLimitRemaining?: number;
      responseTimes: number[];
    }
  >();

  recordInvocation(connectorId: string, record: InvocationRecord): void {
    const existing = this.state.get(connectorId) ?? {
      errorCount: 0,
      responseTimes: [],
    };

    existing.errorCount = 0; // Reset on success
    existing.lastSuccessAt = new Date().toISOString();
    existing.rateLimitRemaining = record.rateLimitRemaining;
    existing.responseTimes.push(record.durationMs);

    // Keep only last 100 response times
    if (existing.responseTimes.length > 100) {
      existing.responseTimes = existing.responseTimes.slice(-100);
    }

    this.state.set(connectorId, existing);
  }

  recordFailure(connectorId: string, _record: FailureRecord): void {
    const existing = this.state.get(connectorId) ?? {
      errorCount: 0,
      responseTimes: [],
    };

    existing.errorCount++;
    existing.lastFailureAt = new Date().toISOString();

    this.state.set(connectorId, existing);
  }

  getHealth(connectorId: string): ConnectorHealth {
    const entry = this.state.get(connectorId);

    if (!entry) {
      return {
        connectorId,
        status: "unknown",
        errorCount: 0,
      };
    }

    let status: ConnectorStatus = "up";

    if (entry.errorCount >= FAILURE_THRESHOLD) {
      status = "down";
    } else if (
      entry.rateLimitRemaining !== undefined &&
      entry.rateLimitRemaining <= RATE_LIMIT_WARNING_THRESHOLD
    ) {
      status = "degraded";
    }

    const avgResponseMs =
      entry.responseTimes.length > 0
        ? entry.responseTimes.reduce((a, b) => a + b, 0) /
          entry.responseTimes.length
        : undefined;

    return {
      connectorId,
      status,
      rateLimitRemaining: entry.rateLimitRemaining,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      errorCount: entry.errorCount,
      avgResponseMs,
    };
  }

  listAll(): ConnectorHealth[] {
    return [...this.state.keys()].map((id) => this.getHealth(id));
  }
}
