import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  POST,
  mapPrometheusAlertToControlPlanePayload,
  resolveAlertEnvironment,
} from "@/app/api/webhooks/prometheus/alerts/route";

describe("prometheus alert mapping", () => {
  it("maps alert labels and annotations into control-plane rollback payload", () => {
    const mapped = mapPrometheusAlertToControlPlanePayload({
      alerts: [
        {
          labels: {
            repository: "team/repo",
            environment: "production",
            namespace: "prod-app",
            source_revision: "abc123",
          },
          annotations: {
            reason: "high_error_rate",
            rollback_image_tag: "rollback-123",
          },
          fingerprint: "fp1",
        },
      ],
      status: "firing",
      receiver: "pager",
    });

    expect(mapped).toMatchObject({
      source: "alertmanager",
      repoName: "team/repo",
      sourceRevision: "abc123",
      rollbackImageTag: "rollback-123",
      reason: "high_error_rate",
      environment: "production",
    });
    expect(mapped.metadata?.alertmanager).toMatchObject({
      status: "firing",
      receiver: "pager",
    });
  });

  it("falls back environment to namespace and repo from repo metadata", () => {
    const mapped = mapPrometheusAlertToControlPlanePayload({
      alerts: [
        {
          labels: {
            repo: "org/service",
            alertname: "high_latency",
            namespace: "staging-web",
          },
          annotations: {},
        },
      ],
      status: "firing",
      receiver: "ops-team",
    });

    expect(mapped.environment).toBe("staging");
    expect(mapped.repoName).toBe("org/service");
    expect(mapped.reason).toMatch(/receiver=ops-team/);
  });

  it("maps alert environment aliases and default label extraction", () => {
    expect(resolveAlertEnvironment("production", "staging-web")).toBe("production");
    expect(resolveAlertEnvironment("dev", "prod-web")).toBe("dev");
    expect(resolveAlertEnvironment(undefined, "staging-svc")).toBe("staging");
    expect(resolveAlertEnvironment(undefined, "preview-canary")).toBe("preview");
  });
});

describe("prometheus webhook route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED = "false";
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";
  });

  it("returns control-plane rollback decisions and respects policy config", async () => {
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN = "prom-token";
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "cp-token";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED = "true";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_SEVERITIES = "critical,warning";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENVIRONMENTS = "production,staging";

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "applied" }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("https://forge.local/api/webhooks/prometheus/alerts", {
      method: "POST",
      headers: {
        authorization: "Bearer prom-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        alerts: [
          {
            labels: {
              alertname: "high_error_rate",
              repository: "team/repo",
              source_revision: "abc123",
              severity: "critical",
              namespace: "prod-app",
            },
            annotations: {
              reason: "rollback_now",
            },
            status: "firing",
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
          },
        ],
        status: "firing",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();
    expect(response.status).toBe(200);

    expect(payload).toMatchObject({
      success: true,
      processed: 1,
      status: "firing",
      controlPlaneRollbacks: [
        {
          alertName: "high_error_rate",
          action: "triggered",
          reason: "Rollback request submitted to ForgeGraph",
        },
      ],
      rollbackPolicyEnabled: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns unauthorized when token is missing", async () => {
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "prom-token";

    const request = new NextRequest("https://forge.local/api/webhooks/prometheus/alerts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        alerts: [
          {
            labels: {
              repository: "team/repo",
            },
            annotations: {},
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Unauthorized" });
  });

  it("short-circuits when rollback policy is disabled", async () => {
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "prom-token";
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED = "false";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("https://forge.local/api/webhooks/prometheus/alerts", {
      method: "POST",
      headers: {
        authorization: "Bearer prom-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        alerts: [
          {
            labels: {
              alertname: "high_error_rate",
              repository: "team/repo",
              source_revision: "abc123",
              severity: "critical",
            },
            annotations: {
              reason: "rollback_now",
            },
            status: "firing",
          },
        ],
        status: "firing",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      rollbackPolicyEnabled: false,
      controlPlaneRollbacks: [
        {
          action: "disabled",
          reason: "Rollback policy disabled in environment",
        },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates identical rollback attempts inside configured window", async () => {
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "prom-token";
    process.env.PROMETHEUS_BEARER_TOKEN = "cp-token";
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED = "true";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_SEVERITIES = "critical";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENVIRONMENTS = "production";

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "applied" }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const payload = {
      alerts: [
        {
          labels: {
            alertname: "dedupe_alert",
            repository: "team/repo-dedupe",
            source_revision: "rev-001",
            severity: "critical",
            namespace: "prod-app",
          },
          annotations: {
            reason: "rollback_now",
          },
          status: "firing",
        },
        {
          labels: {
            alertname: "dedupe_alert",
            repository: "team/repo-dedupe",
            source_revision: "rev-001",
            severity: "critical",
            namespace: "prod-app",
          },
          annotations: {
            reason: "rollback_now",
          },
          status: "firing",
        },
      ],
      status: "firing",
    };

    const request = new NextRequest("https://forge.local/api/webhooks/prometheus/alerts", {
      method: "POST",
      headers: {
        authorization: "Bearer prom-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      processed: 2,
      controlPlaneRollbacks: [
        {
          alertName: "dedupe_alert",
          action: "triggered",
        },
        {
          alertName: "dedupe_alert",
          action: "deduped",
          reason: "Rollback event deduplicated within configured window",
        },
      ],
    });
  });

  it("returns 502 when control-plane rollback request fails", async () => {
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "prom-token";
    process.env.PROMETHEUS_BEARER_TOKEN = "cp-token";
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED = "true";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_SEVERITIES = "critical";
    process.env.FORGEGRAPH_AUTO_ROLLBACK_ENVIRONMENTS = "production";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: "rollback target not found" }),
            { status: 404 }
          )
        )
    );

    const request = new NextRequest("https://forge.local/api/webhooks/prometheus/alerts", {
      method: "POST",
      headers: {
        authorization: "Bearer prom-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        alerts: [
          {
            labels: {
              alertname: "failed_alert",
              repository: "team/repo-fail",
              source_revision: "rev-002",
              severity: "critical",
              namespace: "prod-app",
            },
            annotations: {
              reason: "rollback_now",
            },
            status: "firing",
          },
        ],
        status: "firing",
      }),
    });

    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      success: true,
      processed: 1,
      status: "firing",
      controlPlaneRollbacks: [
        {
          alertName: "failed_alert",
          action: "failed",
          reason: "Control-plane rollback request failed with HTTP 404",
        },
      ],
    });
  });
});
