import { NextResponse } from "next/server";

import { getSession } from "~/auth/server";

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

// Anthropic pricing (USD per million tokens, approximate for claude-3.5/4 family)
const ANTHROPIC_INPUT_COST_PER_M = 3.0;
const ANTHROPIC_OUTPUT_COST_PER_M = 15.0;
const ANTHROPIC_CACHE_READ_COST_PER_M = 0.3;

// OpenAI pricing (USD per million tokens, approximate for gpt-4o family)
const OPENAI_INPUT_COST_PER_M = 2.5;
const OPENAI_OUTPUT_COST_PER_M = 10.0;

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  provider: "anthropic" | "openai",
): number {
  if (provider === "anthropic") {
    return (
      (inputTokens / 1_000_000) * ANTHROPIC_INPUT_COST_PER_M +
      (outputTokens / 1_000_000) * ANTHROPIC_OUTPUT_COST_PER_M +
      (cacheReadTokens / 1_000_000) * ANTHROPIC_CACHE_READ_COST_PER_M
    );
  }
  return (
    (inputTokens / 1_000_000) * OPENAI_INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * OPENAI_OUTPUT_COST_PER_M
  );
}

// ---- Anthropic ----

async function fetchAnthropicUsage(
  apiKey: string,
  bucketWidth: "1h" | "1d",
  startingAt: string,
  endingAt: string,
): Promise<TimeBucket[]> {
  const url = new URL(
    "https://api.anthropic.com/v1/organizations/usage_report/messages",
  );
  url.searchParams.set("bucket_width", bucketWidth);
  url.searchParams.set("starting_at", startingAt);
  url.searchParams.set("ending_at", endingAt);

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`Anthropic usage API error: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = (await res.json()) as {
    data?: Array<{
      starting_at?: string;
      results?: Array<{
        uncached_input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      }>;
    }>;
  };

  return (data.data ?? []).map((b) => {
    const results = b.results ?? [];
    const input = results.reduce((s, r) => s + (r.uncached_input_tokens ?? 0), 0);
    const output = results.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
    const cacheRead = results.reduce((s, r) => s + (r.cache_read_input_tokens ?? 0), 0);
    return {
      start: b.starting_at ?? "",
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      totalTokens: input + output + cacheRead,
      estimatedCost: estimateCost(input, output, cacheRead, "anthropic"),
    };
  });
}

async function fetchAnthropicMonthSpend(apiKey: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const url = new URL(
    "https://api.anthropic.com/v1/organizations/cost_report",
  );
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("starting_at", monthStart.toISOString());
  url.searchParams.set("ending_at", now.toISOString());

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`Anthropic cost API error: ${res.status} ${await res.text()}`);
    return 0;
  }

  // Cost report: each bucket has results[] with amount in cents as a decimal string
  const data = (await res.json()) as {
    data?: Array<{
      results?: Array<{ amount?: string }>;
    }>;
  };

  let totalCents = 0;
  for (const bucket of data.data ?? []) {
    for (const r of bucket.results ?? []) {
      totalCents += Number(r.amount ?? 0);
    }
  }
  // Convert cents to dollars
  return totalCents / 100;
}

async function getAnthropicUsage(): Promise<ProviderUsage> {
  const apiKey = process.env.ANTHROPIC_ADMIN_KEY;
  const limit = Number(process.env.ANTHROPIC_MONTHLY_LIMIT) || 0;

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

  const [fiveHour, weekly, monthSpend] = await Promise.all([
    fetchAnthropicUsage(apiKey, "1h", fiveHoursAgo.toISOString(), now.toISOString()),
    fetchAnthropicUsage(apiKey, "1d", sevenDaysAgo.toISOString(), now.toISOString()),
    fetchAnthropicMonthSpend(apiKey),
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

// ---- OpenAI ----

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
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
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
      estimatedCost: estimateCost(input, output, cacheRead, "openai"),
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
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

async function getOpenAIUsage(): Promise<ProviderUsage> {
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
      getAnthropicUsage(),
      getOpenAIUsage(),
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
