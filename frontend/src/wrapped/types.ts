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

export type WrappedMode = "all" | "videos" | "shorts";

export interface WrappedData {
  year: number;
  mode: WrappedMode;
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
    split: Record<"long" | "short" | "music" | "unknown", { videos: number; est_s: number }>;
    change: Record<string, number | null>;
  };
  top_channels: RankedItem[];
  top_channel_by_time: RankedItem | null;
  top_shorts_channels: RankedItem[];
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

/** Netflix's story data (GET /api/wrapped/<year>?platform=netflix): shows instead of channels. */
export interface NetflixWrappedData {
  platform: "netflix";
  year: number;
  mode: "all";
  empty: boolean;
  has_times: boolean;
  overview: WrappedData["overview"];
  top_channels: RankedItem[];          // top shows
  top_channel_by_time: RankedItem | null;
  top_movies: RankedItem[];
  top_genres: RankedItem[];
  kind_split: { episode: { count: number; est_s: number; titles: number }; movie: { count: number; est_s: number; titles: number } };
  progress: {
    summary: { finished: number; watching: number; dropped: number };
    finished: { key: string; title: string; avatar_url: string | null }[];
    shows: number;
  };
  binge: { key: string; title: string; avatar_url: string | null; season: number; episodes: number; days: number; start: string; end: string; per_day: number } | null;
  episode_day: { date: string; key: string; title: string; episodes: number } | null;
  biggest_day: { date: string; count: number; time_s: number } | null;
  streak: { days: number; start: string; end: string } | null;
  discovery: { channel_id: string; title?: string; avatar_url?: string | null; count: number; first_watched: string } | null;
  clock: HourPoint[];
  peak_hour: number | null;
  metrics: Record<string, number>;
  personality: Personality;
  anime?: {
    sub: number; dub: number; simulcast: number; score: number | null;
    simulcast_series: { key: string; title: string; poster: string | null }[];
    studio: { name: string; count: number; series: { key: string; title: string; poster: string | null }[] } | null;
    season: { season: string; series: { key: string; title: string; poster: string | null }[] } | null;
  } | null;
}

export type AnyWrapped = (WrappedData & { platform?: undefined }) | NetflixWrappedData;

/** Route every YouTube image through the local relay so cards can be exported as PNG. */
export const img = (url: string | null | undefined) => (url ? `/api/img?u=${encodeURIComponent(url)}` : undefined);
export const thumbOf = (videoId: string, stored?: string | null) =>
  img(stored ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
