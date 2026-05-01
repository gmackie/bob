import { describe, expect, it } from "vitest";

import { BaseConnector, type ConnectorResult } from "../base-connector";

class TestConnector extends BaseConnector {
  id = "test";
  name = "Test Connector";

  protected async executeRequest(
    query: string,
  ): Promise<ConnectorResult[]> {
    return [
      {
        id: "result_1",
        title: "Test Result",
        content: "Test content",
        url: "https://example.com",
        source: "test",
        retrievedAt: new Date().toISOString(),
      },
    ];
  }
}

class FailingConnector extends BaseConnector {
  id = "failing";
  name = "Failing Connector";
  callCount = 0;

  protected async executeRequest(
    query: string,
  ): Promise<ConnectorResult[]> {
    this.callCount++;
    throw new Error("Connection refused");
  }
}

class SlowConnector extends BaseConnector {
  id = "slow";
  name = "Slow Connector";

  protected async executeRequest(
    query: string,
  ): Promise<ConnectorResult[]> {
    // Simulate a request that takes much longer than the timeout
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return [
      {
        id: "result_1",
        title: "Should not reach here",
        content: "Content",
        url: "https://example.com",
        source: "test",
        retrievedAt: new Date().toISOString(),
      },
    ];
  }
}

class RateLimitedConnector extends BaseConnector {
  id = "rate-limited";
  name = "Rate Limited Connector";
  callCount = 0;

  protected async executeRequest(
    query: string,
  ): Promise<ConnectorResult[]> {
    this.callCount++;
    if (this.callCount <= 2) {
      const error = new Error("Too Many Requests") as Error & {
        statusCode: number;
      };
      error.statusCode = 429;
      throw error;
    }
    return [
      {
        id: "result_1",
        title: "Eventually worked",
        content: "Content",
        url: "https://example.com",
        source: "test",
        retrievedAt: new Date().toISOString(),
      },
    ];
  }
}

describe("BaseConnector", () => {
  it("executes a successful request", async () => {
    const connector = new TestConnector({
      timeoutMs: 5000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
    });

    const results = await connector.search("test query");
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Test Result");
  });

  it("retries on failure with exponential backoff", async () => {
    const connector = new FailingConnector({
      timeoutMs: 5000,
      maxRetries: 2,
      circuitBreakerThreshold: 5,
      baseDelayMs: 1, // Fast for testing
    });

    await expect(connector.search("test")).rejects.toThrow(
      "Connection refused",
    );
    expect(connector.callCount).toBe(3); // 1 initial + 2 retries
  });

  it("retries on rate limit (429)", async () => {
    const connector = new RateLimitedConnector({
      timeoutMs: 5000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      baseDelayMs: 1,
    });

    const results = await connector.search("test");
    expect(results).toHaveLength(1);
    expect(connector.callCount).toBe(3); // 2 rate limited + 1 success
  });

  it("opens circuit breaker after threshold failures", async () => {
    const connector = new FailingConnector({
      timeoutMs: 5000,
      maxRetries: 0,
      circuitBreakerThreshold: 3,
      baseDelayMs: 1,
    });

    // Exhaust the circuit breaker threshold
    for (let i = 0; i < 3; i++) {
      await expect(connector.search("test")).rejects.toThrow();
    }

    // Next call should fail fast with circuit breaker open
    await expect(connector.search("test")).rejects.toThrow(
      "Circuit breaker open",
    );
  });

  it("aborts and throws a timeout error when execute exceeds configured timeout", async () => {
    const connector = new SlowConnector({
      timeoutMs: 50, // 50ms timeout — request takes 5000ms
      maxRetries: 0,
      circuitBreakerThreshold: 5,
    });

    await expect(connector.search("test")).rejects.toThrow("timed out");
  }, 10_000);
});
