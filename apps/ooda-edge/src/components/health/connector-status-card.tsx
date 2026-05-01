"use client";

interface ConnectorStatusCardProps {
  connectorId: string;
  status: "up" | "degraded" | "down" | "unknown";
  rateLimitRemaining?: number;
  lastSuccessAt?: string;
  errorCount: number;
  avgResponseMs?: number;
}

const STATUS_COLORS = {
  up: "border-[#4A9E6B]/30 text-[#4A9E6B]",
  degraded: "border-[#C49A3C]/30 text-[#C49A3C]",
  down: "border-[#C45454]/30 text-[#C45454]",
  unknown: "border-[#2A2A2F] text-[#8A8580]",
};

export function ConnectorStatusCard(props: ConnectorStatusCardProps) {
  const colorClass = STATUS_COLORS[props.status];

  return (
    <div className={`rounded-[6px] border bg-[#1A1A1E] p-4 ${colorClass}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-medium">
          {props.connectorId}
        </span>
        <span className="rounded px-2 py-0.5 text-xs font-medium uppercase">
          {props.status}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-xs text-[#8A8580]">
        {props.rateLimitRemaining !== undefined && (
          <div>
            <div className="flex justify-between">
              <span>Rate limit remaining:</span>
              <span className="font-mono">{props.rateLimitRemaining}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#2A2A2F]">
              <div
                className={`h-full rounded-full transition-all ${
                  props.rateLimitRemaining > 20
                    ? "bg-[#4A9E6B]"
                    : props.rateLimitRemaining > 5
                      ? "bg-[#C49A3C]"
                      : "bg-[#C45454]"
                }`}
                style={{ width: `${Math.min(100, props.rateLimitRemaining)}%` }}
              />
            </div>
          </div>
        )}
        {props.avgResponseMs !== undefined && (
          <div className="flex justify-between">
            <span>Avg response:</span>
            <span
              className={`font-mono ${
                props.avgResponseMs > 500
                  ? "text-[#C49A3C]"
                  : "text-[#8A8580]"
              }`}
            >
              {Math.round(props.avgResponseMs)}ms
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Errors (24h):</span>
          <span className={`font-mono ${props.errorCount > 0 ? "text-[#C45454]" : ""}`}>
            {props.errorCount}
          </span>
        </div>
        {props.lastSuccessAt && (
          <div className="flex justify-between">
            <span>Last success:</span>
            <span className="font-mono text-[10px]">
              {props.lastSuccessAt}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
