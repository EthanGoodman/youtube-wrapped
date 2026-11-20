import { useState } from "react";
import type { EChartsOption } from "echarts";
import { DayPoint, HourPoint, MonthPoint } from "../api";
import { DOW, duration, hourLabel, month, num, shortDate } from "../format";
import { accent, axis, axisLabel, empty, grid, muted, redRamp, sub } from "../theme";
import { Chart } from "./Chart";

type Measure = "count" | "time";

export function MeasureToggle({ value, onChange }: { value: Measure; onChange: (m: Measure) => void }) {
  return (
    <div className="seg" role="group" aria-label="Show">
      <button aria-pressed={value === "count"} onClick={() => onChange("count")}>Videos</button>
      <button aria-pressed={value === "time"} onClick={() => onChange("time")}>Minutes</button>
    </div>
  );
}

export function useMeasure(initial: Measure = "count") {
  return useState<Measure>(initial);
}

const fmt = (m: Measure, v: number) => (m === "time" ? duration(v) : `${num(v)} videos`);
const val = (m: Measure, p: { count: number; time_s: number }) => (m === "time" ? p.time_s : p.count);

/** stats.fm listening clock: 24 radial bars, midnight at the top. */
export function WatchClock({ data, measure, height = 300 }: { data: HourPoint[]; measure: Measure; height?: number }) {
  const values = data.map((h) => val(measure, h));
  const peak = values.indexOf(Math.max(...values));
  const option: EChartsOption = {
    polar: { radius: ["18%", "88%"] },
    angleAxis: {
      type: "category",
      data: data.map((h) => hourLabel(h.hour)),
      startAngle: 90 + 7.5,
      clockwise: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...axisLabel, interval: 2 },
      splitLine: { show: false },
    },
    radiusAxis: { show: false, min: 0, max: Math.max(1, ...values) },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const { dataIndex } = p as { dataIndex: number };
        const h = data[dataIndex];
        return `<b>${fmt(measure, val(measure, h))}</b><br/><span style="color:${sub}">${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}</span>`;
      },
    },
    series: [{
      type: "bar",
      coordinateSystem: "polar",
      data: values.map((v, i) => ({ value: v, itemStyle: { color: i === peak ? "#ff7a8c" : accent } })),
      barCategoryGap: "18%",
      itemStyle: { borderRadius: 4 },
      emphasis: { itemStyle: { color: "#ff7a8c" } },
    }],
  };
  return <Chart option={option} height={height} ariaLabel={`Watch clock, peak at ${hourLabel(data[peak]?.hour ?? 0)}`} />;
}

/** Vertical bars per month (single measure). */
export function MonthlyBars({ data, measure, height = 260 }: { data: MonthPoint[]; measure: Measure; height?: number }) {
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: data.map((m) => m.month),
      axisLabel: { ...axisLabel, formatter: (v: string) => (data.length > 18 ? (v.endsWith("-01") ? v.slice(0, 4) : "") : month(v)), interval: 0 },
      axisLine: { lineStyle: { color: axis } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: grid } },
      axisLabel: { ...axisLabel, formatter: (v: number) => (measure === "time" ? `${Math.round(v / 3600)}h` : num(v)) },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
      formatter: (p: unknown) => {
        const [first] = p as { dataIndex: number }[];
        const m = data[first.dataIndex];
        return `<b>${fmt(measure, val(measure, m))}</b><br/><span style="color:${sub}">${month(m.month)}</span>`;
      },
    },
    series: [{
      type: "bar",
      data: data.map((m) => val(measure, m)),
      itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 24,
      emphasis: { itemStyle: { color: "#ff7a8c" } },
    }],
  };
  return <Chart option={option} height={height} ariaLabel="Watching per month" />;
}

/** Day-of-week x hour heatmap, sequential red. */
export function WeekHeatmap({ grid: g, measure, height = 280 }: {
  grid: { count: number[][]; time_s: number[][] };
  measure: Measure;
  height?: number;
}) {
  const m = measure === "time" ? g.time_s : g.count;
  const points: [number, number, number][] = [];
  m.forEach((row, d) => row.forEach((v, h) => points.push([h, 6 - d, v])));
  const max = Math.max(1, ...points.map((p) => p[2]));
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => hourLabel(h)), axisLabel: { ...axisLabel, interval: 2 },
             axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: "category", data: [...DOW].reverse(), axisLabel, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: {
      min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 120,
      inRange: { color: redRamp }, textStyle: { color: muted, fontSize: 11 },
      formatter: (v: unknown) => (measure === "time" ? duration(Number(v)) : num(Number(v))),
      outOfRange: { color: empty },
    },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const [h, d, v] = (p as { data: [number, number, number] }).data;
        return `<b>${fmt(measure, v)}</b><br/><span style="color:${sub}">${[...DOW].reverse()[d]} ${hourLabel(h)}</span>`;
      },
    },
    series: [{
      type: "heatmap",
      data: points.map(([h, d, v]) => ({ value: [h, d, v], itemStyle: v === 0 ? { color: empty } : undefined })),
      itemStyle: { borderColor: "#181818", borderWidth: 2, borderRadius: 4 },
      emphasis: { itemStyle: { borderColor: "#f1f1f1", borderWidth: 1 } },
    }],
  };
  return <Chart option={option} height={height} ariaLabel="Weekday by hour heatmap" />;
}

/** GitHub-style calendar: one square per day. Splits into one row per year when long. */
export function CalendarHeat({ data, measure }: { data: DayPoint[]; measure: Measure }) {
  if (!data.length) return null;
  const years = Array.from(new Set(data.map((d) => d.date.slice(0, 4))));
  const values = data.map((d) => val(measure, d));
  const max = Math.max(1, ...values);
  const ranges = years.length > 1 ? years.map((y) => {
    const ds = data.filter((d) => d.date.startsWith(y));
    return [ds[0].date, ds[ds.length - 1].date];
  }) : [[data[0].date, data[data.length - 1].date]];
  const cell = 13;
  const option: EChartsOption = {
    visualMap: { show: false, min: 1, max, inRange: { color: redRamp }, outOfRange: { color: empty } },
    calendar: ranges.map((r, i) => ({
      range: r,
      top: 28 + i * (cell * 7 + 34),
      left: 36,
      right: 8,
      cellSize: ["auto", cell],
      itemStyle: { color: empty, borderColor: "#181818", borderWidth: 3 },
      splitLine: { show: false },
      yearLabel: { show: years.length > 1, position: "left", color: muted, fontSize: 11, margin: 28 },
      dayLabel: { show: false },
      monthLabel: { color: muted, fontSize: 11, nameMap: "en" },
    })),
    tooltip: {
      formatter: (p: unknown) => {
        const [d, v] = (p as { data: [string, number] }).data;
        return `<b>${fmt(measure, v)}</b><br/><span style="color:${sub}">${shortDate(d)}, ${d.slice(0, 4)}</span>`;
      },
    },
    series: ranges.map((_, i) => ({
      type: "heatmap" as const,
      coordinateSystem: "calendar" as const,
      calendarIndex: i,
      data: data.filter((d) => d.date >= ranges[i][0] && d.date <= ranges[i][1]).map((d) => [d.date, val(measure, d)]),
    })),
  };
  return <Chart option={option} height={28 + ranges.length * (cell * 7 + 34)} ariaLabel="Calendar of daily watching" />;
}
