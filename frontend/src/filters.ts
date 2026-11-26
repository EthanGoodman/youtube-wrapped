import { useCallback, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { defaultRange } from "./families";

export type Bucket = "long" | "short" | "music" | "unknown";
export type Metric = "count" | "time";

export interface Filters {
  range: string; // 4w | 6m | this_year | all | custom | YYYY
  start?: string;
  end?: string;
  buckets: Bucket[];
  bg: boolean; // exclude background audio from watch time
  metric: Metric;
}

export const ALL_BUCKETS: Bucket[] = ["long", "short", "music", "unknown"];
const ALL = ALL_BUCKETS;
/** range is the usual default; a platform can open on another one (defaultRange: games open on lifetime). */
export const DEFAULTS: Filters = { range: "this_year", buckets: ALL, bg: true, metric: "count" };

/** Filters live in the URL so every view can be bookmarked or shared. */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const platform = useLocation().pathname.split("/")[1];
  const def = defaultRange(platform);

  const filters: Filters = useMemo(() => {
    const b = params.get("buckets");
    return {
      range: params.get("range") ?? def,
      start: params.get("start") ?? undefined,
      end: params.get("end") ?? undefined,
      buckets: b ? (b.split(",").filter((x) => ALL.includes(x as Bucket)) as Bucket[]) : ALL,
      bg: params.get("bg") !== "0",
      metric: params.get("metric") === "time" ? "time" : "count",
    };
  }, [params, def]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...filters, ...patch };
          const set = (k: string, v: string | undefined, def?: string) =>
            v === undefined || v === def ? next.delete(k) : next.set(k, v);
          set("range", merged.range, def);
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
    [filters, setParams, def],
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
  if (f.buckets.length && f.buckets.length < ALL.length) p.set("buckets", f.buckets.join(","));
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
    case "12m":
      return "the past year";
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
