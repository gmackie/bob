"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  type ChartConfig,
} from "@linear-clone/ui/components/chart";
import { FolderKanban } from "lucide-react";

interface ProjectData {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  completedCount: number;
}

interface CompletionByProjectWidgetProps {
  data: ProjectData[];
  isLoading?: boolean;
}

export function CompletionByProjectWidget({ data, isLoading }: CompletionByProjectWidgetProps) {
  const chartData = data.slice(0, 5).map((p) => ({
    name: p.projectName,
    count: p.completedCount,
    fill: p.projectColor ?? "#6366f1",
  }));

  const chartConfig = chartData.reduce(
    (acc, item, index) => ({
      ...acc,
      [`bar${index}`]: {
        label: item.name,
        color: item.fill,
      },
    }),
    { count: { label: "Completed" } } as ChartConfig
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <FolderKanban className="h-4 w-4 text-primary" />
          By Project
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="h-[150px] bg-muted/50 rounded animate-pulse" />
        ) : data.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[150px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                width={80}
                fontSize={11}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(value) =>
                  value.length > 12 ? `${value.slice(0, 12)}...` : value
                }
              />
              <ChartTooltip
                content={<ChartTooltipContent hideIndicator />}
                cursor={false}
              />
              <Bar
                dataKey="count"
                radius={[0, 4, 4, 0]}
                fill="var(--color-count)"
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No completed tasks
          </p>
        )}
      </CardContent>
    </Card>
  );
}
