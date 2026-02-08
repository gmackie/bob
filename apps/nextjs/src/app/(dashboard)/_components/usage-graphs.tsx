"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TimeBucket = {
  start: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

type ProviderUsage = {
  configured: boolean;
  fiveHour: TimeBucket[];
  weekly: TimeBucket[];
  monthSpend: number;
  monthLimit: number;
  monthRemaining: number;
};

type UsageResponse = {
  generatedAt: string;
  claude: ProviderUsage;
  codex: ProviderUsage;
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function budgetColor(remaining: number, limit: number): string {
  if (limit <= 0) return "var(--dash-dimmer)";
  const pct = remaining / limit;
  if (pct > 0.5) return "var(--dash-success)";
  if (pct > 0.2) return "var(--dash-warn)";
  return "var(--dash-danger)";
}

function formatHour(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatDay(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function CustomTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter: (iso: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-usageTooltip">
      <div className="dash-usageTooltipLabel">{formatter(label ?? "")}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, fontSize: "12px" }}>
          {p.name}: {fmtTokens(p.value)}
        </div>
      ))}
    </div>
  );
}

function UsageChart({
  data,
  formatter,
}: {
  data: TimeBucket[];
  formatter: (iso: string) => string;
}) {
  if (data.length === 0) {
    return (
      <div className="dash-usageEmpty">No data for this period</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dash-accent)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--dash-accent)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dash-success)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--dash-success)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.06)"
        />
        <XAxis
          dataKey="start"
          tickFormatter={formatter}
          tick={{ fontSize: 10, fill: "rgba(232,238,248,0.5)" }}
          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtTokens}
          tick={{ fontSize: 10, fill: "rgba(232,238,248,0.5)" }}
          axisLine={false}
          tickLine={false}
          width={45}
        />
        <Tooltip
          content={<CustomTooltip formatter={formatter} />}
        />
        <Area
          type="monotone"
          dataKey="inputTokens"
          name="Input"
          stackId="1"
          stroke="var(--dash-accent)"
          fill="url(#gradInput)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="outputTokens"
          name="Output"
          stackId="1"
          stroke="var(--dash-success)"
          fill="url(#gradOutput)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function BudgetBar({ provider }: { provider: ProviderUsage }) {
  const pct =
    provider.monthLimit > 0
      ? Math.min(1, provider.monthSpend / provider.monthLimit)
      : 0;
  const color = budgetColor(provider.monthRemaining, provider.monthLimit);

  return (
    <div className="dash-usageBudgetBar">
      <div className="dash-usageBudgetMeta">
        <span>
          <span style={{ color, fontWeight: 700 }}>
            {fmtUsd(provider.monthRemaining)}
          </span>
          <span style={{ color: "var(--dash-dimmer)" }}> remaining</span>
        </span>
        <span style={{ color: "var(--dash-dimmer)", fontSize: "11px" }}>
          {fmtUsd(provider.monthSpend)} / {fmtUsd(provider.monthLimit)}
        </span>
      </div>
      <div className="dash-usageBudgetTrack">
        <div
          className="dash-usageBudgetFill"
          style={{
            width: `${pct * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  provider,
}: {
  name: string;
  provider: ProviderUsage;
}) {
  if (!provider.configured) {
    return (
      <div className="dash-usageCard">
        <div className="dash-usageCardHeader">
          <div className="dash-usageCardTitle">{name}</div>
          <div className="dash-usageCardBadge dash-usageCardBadgeOff">
            Not configured
          </div>
        </div>
        <div className="dash-usageEmpty">
          Set the admin API key in your environment to enable usage tracking.
        </div>
      </div>
    );
  }

  return (
    <div className="dash-usageCard">
      <div className="dash-usageCardHeader">
        <div className="dash-usageCardTitle">{name}</div>
        <div className="dash-usageCardBadge">Active</div>
      </div>

      <BudgetBar provider={provider} />

      <div className="dash-usageChartSection">
        <div className="dash-usageChartLabel">Last 5 hours (hourly)</div>
        <UsageChart data={provider.fiveHour} formatter={formatHour} />
      </div>

      <div className="dash-usageChartSection">
        <div className="dash-usageChartLabel">Last 7 days (daily)</div>
        <UsageChart data={provider.weekly} formatter={formatDay} />
      </div>
    </div>
  );
}

export function UsageGraphs() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        setUsage(null);
        return;
      }
      const data = (await res.json()) as UsageResponse;
      setUsage(data);
    } catch {
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();

    const interval = setInterval(() => {
      void loadUsage();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [loadUsage]);

  if (loading) {
    return (
      <div className="dash-usageSection">
        <div className="dash-usageLoading">Loading usage data...</div>
      </div>
    );
  }

  if (!usage) {
    return null;
  }

  // Don't render if neither provider is configured
  if (!usage.claude.configured && !usage.codex.configured) {
    return null;
  }

  return (
    <div className="dash-usageSection">
      <ProviderCard name="Claude" provider={usage.claude} />
      <ProviderCard name="Codex" provider={usage.codex} />
    </div>
  );
}
