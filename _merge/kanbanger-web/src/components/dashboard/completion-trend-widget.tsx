"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  type ChartConfig,
} from "@linear-clone/ui/components/chart";
import { TrendingUp } from "lucide-react";
import { format, subDays } from "date-fns";

interface CompletionTrendWidgetProps {
  data: Array<{ date: string; count: number }>;
  isLoading?: boolean;
}

const chartConfig = {
  count: {
    label: "Completed",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

export function CompletionTrendWidget({ data, isLoading }: CompletionTrendWidgetProps) {
  const today = new Date();
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const date = format(subDays(today, 13 - i), "yyyy-MM-dd");
    const found = data.find((d) => d.date === date);
    return {
      date,
      count: found?.count ?? 0,
      displayDate: format(subDays(today, 13 - i), "MMM d"),
    };
  });

  const totalCompleted = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Completion Trend
          </div>
          <span className="text-2xl font-bold">{totalCompleted}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">Last 14 days</p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="h-[120px] bg-muted/50 rounded animate-pulse" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[120px] w-full">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-count)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-count)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="displayDate"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={10}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
              />
              <YAxis hide />
              <ChartTooltip
                content={<ChartTooltipContent hideIndicator />}
                cursor={false}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-count)"
                fill="url(#fillCount)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
