import { appToken } from "../api";
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
export interface ShowsWrappedData {
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

type Song = RankedItem & { cover?: string | null; artist?: string | null };

/** Music Wrapped (Spotify, …): streams are plays of 30 s or more. */
export interface MusicWrappedData {
  kind: "music";
  platform: string;
  year: number;
  mode: "all";
  empty: boolean;
  overview: { videos: number; unique_videos: number; unique_channels: number; est_s: number; active_days: number; days: number;
              change: Record<string, number | null> };
  top_artists: RankedItem[];
  top_tracks: Song[];
  top_albums: Song[];
  top_genres: RankedItem[];
  clock: HourPoint[];
  peak_hour: number;
  biggest_day: { date: string; count: number; time_s: number } | null;
  streak: { days: number; start: string; end: string } | null;
  on_repeat: { key: string; title: string; artist: string; cover: string | null; date: string; count: number } | null;
  discovery: { channel_id: string; title: string | null; avatar_url: string | null; first_watched: string; count: number; time_s: number } | null;
  personality: Personality;
}

/** Games Wrapped (Steam, Epic…): the year told by its achievement unlocks (real, timestamped), plus hours only for
 *  days the app tracked. Game platforms don't say when past hours were played, so none are invented. */
export type GameCard = { key: string; title: string | null; poster: string | null; header?: string | null };
export type GameUnlock = { game: GameCard; api: string; name: string; description: string | null; unlocked: string; rarity: number | null };
export interface GamesWrappedData {
  kind: "games";
  platform: string;
  year: number;
  mode: "all";
  empty: boolean;
  tracked_since: string | null;
  unlocks: number;
  active_days: number;
  games: number;
  top_games: { game: GameCard; unlocks: number; share: number }[];
  new_games: GameCard[];
  rarest: GameUnlock[];
  best_day: { date: string; game: GameCard; count: number } | null;
  streak: { days: number; start: string; end: string } | null;
  latest_night: GameUnlock | null;
  busiest_hour: number | null;
  hours: number[];
  perfect: { game: GameCard; achievements: number; completed: string }[];
  tracked: { est_s: number; days: number; top: GameCard | null } | null;
  platinums: { count: number; latest: GameUnlock } | null;
  personality: Personality;
}

/** Social Wrapped (Instagram): the year in real, dated actions; no time spent. */
type SocialPerson = { key: string; name: string; count: number; first: string; last: string; sent?: number; received?: number };
export interface SocialWrappedData {
  kind: "social";
  platform: string;
  year: number;
  mode: "all";
  empty: boolean;
  summary: { likes: number; comments: number; saves: number; follows: number; posts: number; stories: number; messages: number;
             messages_sent: number; messages_received: number; shared: number; chats: number; accounts_liked: number; active_days: number };
  people: { liked: SocialPerson[]; chats: SocialPerson[]; shared_with: SocialPerson[]; commented: SocialPerson[] };
  tags: { tag: string; count: number }[];
  busiest_hour: number | null;
  hours: number[];
  weekdays: number[];
  active_days: number;
  personality: Personality;
}

export type AnyWrapped = (WrappedData & { platform?: undefined; kind?: undefined }) | ShowsWrappedData | MusicWrappedData | GamesWrappedData | SocialWrappedData;

/** Route every YouTube image through the local relay so cards can be exported as PNG. */
// <img src> can't send headers, so the relay takes the app token as a query parameter
export const img = (url: string | null | undefined) =>
  (url ? `/api/img?u=${encodeURIComponent(url)}&t=${encodeURIComponent(appToken)}` : undefined);
export const thumbOf = (videoId: string, stored?: string | null) =>
  img(stored ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
