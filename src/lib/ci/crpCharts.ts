import type { EChartsOption } from "echarts";
import { summarizeTiming, timingDuration } from "./crpTimings";
import type { Build, CrpTimingAnalysis, CrpTimingAttempt } from "./types";

export const formatTimingMs = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)} ms`;
export const timingAttemptLabel = (retry: number) =>
  retry === 0 ? "Original attempt" : `Retry ${retry}`;
export const timingDateLabel = (build: Build, timeZone?: string) =>
  new Date(build.startedIso).toLocaleString(timeZone ? "en-US" : undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

export function crpChartRows(analysis: CrpTimingAnalysis) {
  const byBuild = new Map(
    analysis.results.map((result) => [result.buildId, result]),
  );
  return analysis.builds
    .toSorted((a, b) => a.startedMs - b.startedMs)
    .map((build) => {
      const result = byBuild.get(build.id);
      const latest = result?.attempts.reduce<CrpTimingAttempt | undefined>(
        (previous, attempt) =>
          !previous || attempt.retry > previous.retry ? attempt : previous,
        undefined,
      );
      return { build, result, latest };
    });
}

export function crpTrendRows(
  rows: ReturnType<typeof crpChartRows>,
  metric: string,
  hideWithoutTimings: boolean,
) {
  return rows
    .map((row) => ({
      ...row,
      stats: row.latest ? summarizeTiming(row.latest, metric) : null,
    }))
    .filter((row) => !hideWithoutTimings || row.stats !== null);
}

function durationAxis(textColor: string): EChartsOption["yAxis"] {
  return {
    type: "value",
    min: 0,
    name: "Duration (ms)",
    nameLocation: "middle",
    nameRotate: 90,
    nameGap: 60,
    nameTextStyle: { color: textColor },
    axisLine: { show: true, lineStyle: { color: textColor } },
    axisTick: { show: true, lineStyle: { color: textColor } },
    axisLabel: { show: true, color: textColor },
    splitLine: { show: true },
  };
}

export function crpTrendOption(
  rows: ReturnType<typeof crpTrendRows>,
  metric: string,
  {
    timeZone,
    textColor = "currentColor",
    interactive = true,
  }: { timeZone?: string; textColor?: string; interactive?: boolean } = {},
): EChartsOption {
  return {
    animation: false,
    aria: {
      enabled: true,
      description: `Mean ${metric} duration across CI runs in milliseconds.`,
    },
    grid: { left: 100, right: 24, top: 24, bottom: interactive ? 90 : 55 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      confine: true,
      formatter: "{b}\nMean: {c} ms",
    },
    xAxis: {
      type: "category",
      data: rows.map(({ build }) => timingDateLabel(build, timeZone)),
      name: "CI run (oldest → newest)",
      nameLocation: "middle",
      nameGap: 32,
    },
    yAxis: durationAxis(textColor),
    ...(interactive
      ? {
          dataZoom: [
            { type: "inside" as const },
            { type: "slider" as const, bottom: 4, height: 18 },
          ],
        }
      : {}),
    series: [
      {
        type: "line",
        name: metric,
        showSymbol: true,
        symbolSize: 8,
        connectNulls: false,
        data: rows.map(({ build, latest, stats }) => ({
          name: `${timingDateLabel(build, timeZone)} · Build ${build.id}\nPR ${build.prNumber ?? "—"} · ${build.baseRef}\n${latest ? timingAttemptLabel(latest.retry) : "No timings"}${stats ? ` · ${stats.count} loads\nRange: ${formatTimingMs(stats.min)} – ${formatTimingMs(stats.max)}` : ""}`,
          value: stats ? Number(stats.mean.toFixed(1)) : null,
        })),
      },
    ],
  };
}

export function crpLoadOption(
  attempt: CrpTimingAttempt | undefined,
  metric: string,
  textColor = "currentColor",
): EChartsOption {
  return {
    animation: false,
    aria: {
      enabled: true,
      description: `${metric} duration for each repeated page load in milliseconds.`,
    },
    grid: { left: 100, right: 24, top: 24, bottom: 55 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      confine: true,
      formatter: "{b}: {c} ms",
    },
    xAxis: {
      type: "category",
      data: attempt?.loads.map((_, i) => `Load ${i + 1}`) ?? [],
      name: "Repeated page load",
      nameLocation: "middle",
      nameGap: 32,
    },
    yAxis: durationAxis(textColor),
    series: [
      {
        type: "line",
        name: metric,
        showSymbol: true,
        symbolSize: 10,
        connectNulls: false,
        data:
          attempt?.loads.map((load, i) => ({
            name: `Load ${i + 1}`,
            value: timingDuration(load, metric),
          })) ?? [],
      },
    ],
  };
}
