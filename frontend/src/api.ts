import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Filters, toQuery, useFilters } from "./filters";
import { DEFAULT_PLATFORM, PlatformInfo, usePlatformId } from "./platform";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The per-install token the server put in this page (it guards every /api call against other sites). */
export const appToken: string = document.querySelector<HTMLMetaElement>('meta[name="wrapped-token"]')?.content ?? "";

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "X-Wrapped-Token": appToken } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** Fetch an API path with the current global filters applied. Keeps the previous data while refetching. */
export function useStats<T>(path: string, extra: Record<string, string | number | undefined> = {},
                            opts: { enabled?: boolean; filters?: Filters } = {}) {
  const { filters: urlFilters } = useFilters();
  const platform = usePlatformId() ?? DEFAULT_PLATFORM;
  const f = opts.filters ?? urlFilters;
  const url = `/api/${path}?${toQuery(f, { platform, ...extra })}`;
  return useQuery<T, ApiError>({
    queryKey: [url],
    queryFn: () => getJson<T>(url),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useMeta() {
  const platform = usePlatformId() ?? DEFAULT_PLATFORM;
  return useQuery<Meta, ApiError>({
    queryKey: ["meta", platform],
    queryFn: () => getJson<Meta>(`/api/meta?platform=${platform}`),
    staleTime: 60_000,
  });
}

export interface PlatformSummary extends PlatformInfo {
  has_data: boolean;
  items?: number;
  est_s?: number;
  first_date?: string | null;
  last_date?: string | null;
}

/** All platforms, with a headline for the ones that have data (the hub page). */
export function usePlatforms() {
  return useQuery<PlatformSummary[], ApiError>({ queryKey: ["platforms"], queryFn: () => getJson("/api/platforms") });
}

// ------------------------------------------------------------------ types

export interface Meta {
  platform: PlatformInfo;
  timezone: string;
  today: string;
  first_date: string | null;
  last_date: string | null;
  years: number[];
  watches: number;
  enriched: boolean;
  has_music: boolean;
  has_search: boolean;
  by_bucket: Partial<Record<"long" | "short" | "music" | "unknown", number>>;
  built_at: string | null;
  watchtime: {
    session_gap_minutes: number;
    max_seconds_per_video: number;
    unknown_duration_fallback_seconds: number;
    max_possible_cap_seconds: number;
  };
}

export interface RangeInfo {
  start: string;
  end: string;
  days: number;
  label: string;
}

export interface WatchInfo {
  entry_id: number;
  video_id: string | null;
  local_iso: string;
  title: string | null;
  channel: string | null;
  channel_id: string | null;
  thumb: string | null;
  kind: string;
  bucket: "long" | "short" | "music" | "unknown";
  duration_s: number | null;
  est_s: number;
}

export interface Totals {
  videos: number;
  unique_videos: number;
  unique_channels: number;
  est_s: number;
  max_s: number;
  active_days: number;
  days: number;
  pct_days_active: number;
  avg_videos_per_day: number;
  avg_est_s_per_day: number;
  background_videos: number;
  background_s: number;
  unknown_duration_videos: number;
}

export interface Overview extends Totals {
  range: RangeInfo;
  change: Record<"videos" | "unique_videos" | "unique_channels" | "est_s" | "active_days", number | null>;
  previous: Totals;
  split: Record<"long" | "short" | "music" | "unknown", { videos: number; est_s: number }>;
  first_watch: WatchInfo | null;
  last_watch: WatchInfo | null;
}

export interface RankedItem {
  key: string;
  count: number;
  time_s: number;
  shorts?: number; // how many of `count` were Shorts
  share: number;
  rank: number;
  prev_rank: number | null;
  rank_change: number | null;
  comparable: boolean;
  is_new: boolean;
  title?: string | null;
  // channels
  avatar_url?: string | null;
  subscriber_count?: number | null;
  handle?: string | null;
  first_watched?: string;
  last_watched?: string;
  // videos
  thumb?: string | null;
  duration_s?: number | null;
  channel_id?: string | null;
  channel?: string | null;
  bucket?: "long" | "short" | "music" | "unknown";
  kind?: string;
}

export interface TopResponse {
  range: RangeInfo;
  metric: "count" | "time";
  items: RankedItem[];
}

export interface HourPoint {
  hour: number;
  count: number;
  time_s: number;
}
export interface DayPoint {
  date: string;
  count: number;
  time_s: number;
}
export interface MonthPoint {
  month: string;
  count: number;
  time_s: number;
  long?: number;
  short?: number;
  music?: number;
}
