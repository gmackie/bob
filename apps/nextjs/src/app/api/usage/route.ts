import { NextResponse } from "next/server";

import { getSession } from "~/auth/server";

// ---- Types ----

type ClaudeUtilWindow = {
  utilization: number; // percentage 0-100
  resetsAt: string; // ISO timestamp
} | null;

type ClaudeUsage = {
  configured: boolean;
  fiveHour: ClaudeUtilWindow;
  sevenDay: ClaudeUtilWindow;
  sevenDaySonnet: ClaudeUtilWindow;
  sevenDayOpus: ClaudeUtilWindow;
  rateLimitTier: string | null;
};

type TimeBucket = {
  start: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

type CodexUsage = {
  configured: boolean;
  fiveHour: TimeBucket[];
  weekly: TimeBucket[];
  monthSpend: number;
  monthLimit: number;
  monthRemaining: number;
};

type UsageResponse = {
  generatedAt: string;
  claude: ClaudeUsage;
  codex: CodexUsage;
};

// ---- Claude (claude.ai session cookie) ----

const CLAUDE_ORG_ID = process.env.CLAUDE_ORG_ID;
const CLAUDE_SESSION_COOKIE = process.env.CLAUDE_SESSION_COOKIE;

function parseUtilWindow(
  raw: { utilization?: number; resets_at?: string } | null | undefined,
): ClaudeUtilWindow {
  if (!raw || raw.utilization == null) return null;
  return {
    utilization: raw.utilization,
    resetsAt: raw.resets_at ?? "",
  };
}

async function getClaudeUsage(): Promise<ClaudeUsage> {
  if (!CLAUDE_SESSION_COOKIE || !CLAUDE_ORG_ID) {
    return {
      configured: false,
      fiveHour: null,
      sevenDay: null,
      sevenDaySonnet: null,
      sevenDayOpus: null,
      rateLimitTier: null,
    };
  }

  try {
    const [usageRes, limitsRes] = await Promise.all([
      fetch(
        `https://claude.ai/api/organizations/${CLAUDE_ORG_ID}/usage`,
        {
          headers: { Cookie: CLAUDE_SESSION_COOKIE },
          cache: "no-store",
        },
      ),
      fetch(
        `https://claude.ai/api/organizations/${CLAUDE_ORG_ID}/rate_limits`,
        {
          headers: { Cookie: CLAUDE_SESSION_COOKIE },
          cache: "no-store",
        },
      ),
    ]);

    if (!usageRes.ok) {
      console.error(
        `Claude usage API error: ${usageRes.status} ${await usageRes.text()}`,
      );
      return {
        configured: true,
        fiveHour: null,
        sevenDay: null,
        sevenDaySonnet: null,
        sevenDayOpus: null,
        rateLimitTier: null,
      };
    }

    const usage = (await usageRes.json()) as Record<string, unknown>;
    const limits = limitsRes.ok
      ? ((await limitsRes.json()) as { rate_limit_tier?: string })
      : null;

    return {
      configured: true,
      fiveHour: parseUtilWindow(
        usage.five_hour as { utilization?: number; resets_at?: string } | null,
      ),
      sevenDay: parseUtilWindow(
        usage.seven_day as { utilization?: number; resets_at?: string } | null,
      ),
      sevenDaySonnet: parseUtilWindow(
        usage.seven_day_sonnet as {
          utilization?: number;
          resets_at?: string;
        } | null,
      ),
      sevenDayOpus: parseUtilWindow(
        usage.seven_day_opus as {
          utilization?: number;
          resets_at?: string;
        } | null,
      ),
      rateLimitTier: limits?.rate_limit_tier ?? null,
    };
  } catch (error) {
    console.error("Claude usage fetch error:", error);
    return {
      configured: true,
      fiveHour: null,
      sevenDay: null,
      sevenDaySonnet: null,
      sevenDayOpus: null,
      rateLimitTier: null,
    };
  }
}

// ---- Codex / OpenAI (admin API key) ----

const OPENAI_INPUT_COST_PER_M = 2.5;
const OPENAI_OUTPUT_COST_PER_M = 10.0;

function estimateCost(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * OPENAI_INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * OPENAI_OUTPUT_COST_PER_M
  );
}

async function fetchOpenAIUsage(
  apiKey: string,
  bucketWidth: "1h" | "1d",
  startTime: number,
  endTime: number,
): Promise<TimeBucket[]> {
  const url = new URL(
    "https://api.openai.com/v1/organization/usage/completions",
  );
  url.searchParams.set("bucket_width", bucketWidth);
  url.searchParams.set("start_time", String(startTime));
  url.searchParams.set("end_time", String(endTime));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`OpenAI usage API error: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = (await res.json()) as {
    data?: Array<{
      start_time?: number;
      results?: Array<{
        input_tokens?: number;
        output_tokens?: number;
        input_cached_tokens?: number;
      }>;
    }>;
  };

  return (data.data ?? []).map((b) => {
    const results = b.results ?? [];
    const input = results.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
    const output = results.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
    const cacheRead = results.reduce(
      (s, r) => s + (r.input_cached_tokens ?? 0),
      0,
    );
    return {
      start: b.start_time
        ? new Date(b.start_time * 1000).toISOString()
        : "",
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      totalTokens: input + output + cacheRead,
      estimatedCost: estimateCost(input, output),
    };
  });
}

async function fetchOpenAIMonthSpend(apiKey: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const url = new URL("https://api.openai.com/v1/organization/costs");
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set(
    "start_time",
    String(Math.floor(monthStart.getTime() / 1000)),
  );
  url.searchParams.set(
    "end_time",
    String(Math.floor(now.getTime() / 1000)),
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`OpenAI cost API error: ${res.status} ${await res.text()}`);
    return 0;
  }

  const data = (await res.json()) as {
    data?: Array<{
      results?: Array<{ amount?: { value?: number } }>;
    }>;
  };

  return (data.data ?? []).reduce((sum, b) => {
    const bucketSum = (b.results ?? []).reduce(
      (s, r) => s + (r.amount?.value ?? 0),
      0,
    );
    return sum + bucketSum;
  }, 0);
}

async function getCodexUsage(): Promise<CodexUsage> {
  const apiKey = process.env.OPEN_AI_ADMIN_KEY;
  const limit = Number(process.env.OPENAI_MONTHLY_LIMIT) || 0;

  if (!apiKey) {
    return {
      configured: false,
      fiveHour: [],
      weekly: [],
      monthSpend: 0,
      monthLimit: limit,
      monthRemaining: limit,
    };
  }

  const now = new Date();
  const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startH = Math.floor(fiveHoursAgo.getTime() / 1000);
  const startD = Math.floor(sevenDaysAgo.getTime() / 1000);
  const end = Math.floor(now.getTime() / 1000);

  const [fiveHour, weekly, monthSpend] = await Promise.all([
    fetchOpenAIUsage(apiKey, "1h", startH, end),
    fetchOpenAIUsage(apiKey, "1d", startD, end),
    fetchOpenAIMonthSpend(apiKey),
  ]);

  return {
    configured: true,
    fiveHour,
    weekly,
    monthSpend,
    monthLimit: limit,
    monthRemaining: Math.max(0, limit - monthSpend),
  };
}

// ---- Route handler ----

export async function GET() {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [claude, codex] = await Promise.all([
      getClaudeUsage(),
      getCodexUsage(),
    ]);

    const response: UsageResponse = {
      generatedAt: new Date().toISOString(),
      claude,
      codex,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
