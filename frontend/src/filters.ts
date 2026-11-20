import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type Bucket = "long" | "short" | "music";
export type Metric = "count" | "time";

export interface Filters {
  range: string; // 4w | 6m | this_year | all | custom | YYYY
  start?: string;
  end?: string;
  buckets: Bucket[];
  bg: boolean; // exclude background audio from watch time
  metric: Metric;
}

const ALL: Bucket[] = ["long", "short", "music"];
export const DEFAULTS: Filters = { range: "4w", buckets: ALL, bg: true, metric: "count" };

/** Filters live in the URL so every view can be bookmarked or shared. */
export function useFilters() {
  const [params, setParams] = useSearchParams();

  const filters: Filters = useMemo(() => {
    const b = params.get("buckets");
    return {
      range: params.get("range") ?? DEFAULTS.range,
      start: params.get("start") ?? undefined,
      end: params.get("end") ?? undefined,
      buckets: b ? (b.split(",").filter((x) => ALL.includes(x as Bucket)) as Bucket[]) : ALL,
      bg: params.get("bg") !== "0",
      metric: params.get("metric") === "time" ? "time" : "count",
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...filters, ...patch };
          const set = (k: string, v: string | undefined, def?: string) =>
            v === undefined || v === def ? next.delete(k) : next.set(k, v);
          set("range", merged.range, DEFAULTS.range);
          set("start", merged.range === "custom" ? merged.start : undefined);
          set("end", merged.range === "custom" ? merged.end : undefined);
          const bucketStr = merged.buckets.length === ALL.length ? undefined : merged.buckets.join(",");
          set("buckets", bucketStr);
          set("bg", merged.bg ? undefined : "0");
          set("metric", merged.metric, "count");
          return next;
        },
        { replace: true },
      );
    },
    [filters, setParams],
  );

  return { filters, update };
}

/** Query string for the API from filters (+ extra params). */
export function toQuery(f: Filters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  p.set("range", f.range);
  if (f.range === "custom" && f.start && f.end) {
    p.set("start", f.start);
    p.set("end", f.end);
  }
  if (f.buckets.length && f.buckets.length < 3) p.set("buckets", f.buckets.join(","));
  if (!f.bg) p.set("bg", "0");
  p.set("metric", f.metric);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

/** Keep the current filters when following a link to another page. */
export function useLinkQuery(): string {
  const [params] = useSearchParams();
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function rangeLabel(f: Filters): string {
  switch (f.range) {
    case "4w":
      return "the past 4 weeks";
    case "6m":
      return "the past 6 months";
    case "this_year":
      return "this year";
    case "all":
      return "all time";
    case "custom":
      return f.start && f.end ? `${f.start} – ${f.end}` : "a custom range";
    default:
      return f.range;
  }
}
