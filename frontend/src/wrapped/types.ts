import type { HourPoint, RankedItem, WatchInfo } from "../api";

export interface Personality {
  id: string;
  name: string;
  emoji: string;
  color: string | null;
  tagline: string | null;
  reason: string;
  metric: string | null;
  value: number | null;
  also: { id: string; name: string; emoji: string }[];
}

export interface WrappedData {
  year: number;
  empty: boolean;
  overview: {
    videos: number;
    unique_videos: number;
    unique_channels: number;
    est_s: number;
    max_s: number;
    active_days: number;
    days: number;
    pct_days_active: number;
    split: Record<"long" | "short" | "music", { videos: number; est_s: number }>;
    change: Record<string, number | null>;
  };
  top_channels: RankedItem[];
  top_channel_by_time: RankedItem | null;
  top_videos: RankedItem[];
  top_categories: RankedItem[];
  top_genres: RankedItem[];
  clock: HourPoint[];
  peak_hour: number;
  biggest_day: { date: string; count: number; time_s: number } | null;
  longest_session: { videos: number; time_s: number; start: string; top_channel: string | null } | null;
  streak: { days: number; start: string; end: string } | null;
  latest_night: WatchInfo | null;
  discovery: { channel_id: string; title?: string; avatar_url?: string | null; count: number; first_watched: string } | null;
  metrics: Record<string, number>;
  personality: Personality;
}

/** Route every YouTube image through the local relay so cards can be exported as PNG. */
export const img = (url: string | null | undefined) => (url ? `/api/img?u=${encodeURIComponent(url)}` : undefined);
export const thumbOf = (videoId: string, stored?: string | null) =>
  img(stored ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
