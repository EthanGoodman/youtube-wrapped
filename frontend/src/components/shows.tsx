/* Pieces for platforms with episodic shows (Netflix): show progress, binges, episodes vs movies. */
import { Link, useHasSeries } from "../platform";
import { useStats } from "../api";
import { Avatar } from "./ui";
import { date, duration, num, pct } from "../format";
import { useLinkQuery } from "../filters";
import { categorical } from "../theme";

export type ShowStatus = "finished" | "watching" | "dropped";

export interface ShowProgress {
  key: string;
  title: string;
  avatar_url: string | null;
  count: number;
  time_s: number;
  last_watched: string;
  watched: number;
  total: number | null;
  pct: number | null;
  seasons_total: number | null;
  seasons_finished: number | null;
  status: ShowStatus;
}

export interface Binge {
  key: string; title: string; avatar_url: string | null; season: number;
  episodes: number; days: number; start: string; end: string; per_day: number;
}

export interface EpisodeDay { date: string; key: string; title: string; avatar_url: string | null; episodes: number; time_s: number }

export interface KindSplit { episode: { count: number; est_s: number; titles: number }; movie: { count: number; est_s: number; titles: number } }

/** GET /api/shows/<kind> for the current platform and filters. */
export function useShows<T>(kind: string, extra: Record<string, string | number | undefined> = {}, disabled = false) {
  const series = useHasSeries();
  return useStats<{ data: T }>(`shows/${kind}`, extra, { enabled: series && !disabled });
}

export const STATUS_LABEL: Record<ShowStatus, string> = { finished: "Finished", watching: "Watching", dropped: "Dropped" };

function StatusBadge({ status }: { status: ShowStatus }) {
  const cls = {
    finished: "bg-up/15 text-up",
    watching: "bg-yt/15 text-yt-soft",
    dropped: "bg-raised text-muted",
  }[status];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{STATUS_LABEL[status]}</span>;
}

/** One row per show: poster, how far you got (bar), and finished / watching / dropped. */
export function ShowProgressRows({ shows }: { shows: ShowProgress[] }) {
  const q = useLinkQuery();
  return (
    <ul className="flex flex-col">
      {shows.map((s) => (
        <li key={s.key}>
          <Link to={`/channel/${s.key}${q}`} className="link-row">
            <Avatar src={s.avatar_url} name={s.title} size={64} shape="poster" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{s.title}</span>
                <StatusBadge status={s.status} />
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised"
                   role="img" aria-label={s.pct != null ? `${pct(s.pct)} watched` : "progress unknown"}>
                <div className={`h-full rounded-full ${s.status === "dropped" ? "bg-muted" : "bg-yt"}`}
                     style={{ width: `${(s.pct ?? 0) * 100}%` }} />
              </div>
              <div className="mt-1.5 truncate text-xs text-sub">
                {s.total != null ? `${num(s.watched)} of ${num(s.total)} episodes` : `${num(s.watched)} episodes`}
                {s.seasons_total ? ` · ${num(s.seasons_finished ?? 0)} of ${num(s.seasons_total)} seasons done` : ""}
                {` · last ${date(s.last_watched)}`}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Seasons finished, fastest first. */
export function BingeRows({ binges }: { binges: Binge[] }) {
  const q = useLinkQuery();
  return (
    <ul className="flex flex-col">
      {binges.map((b, i) => (
        <li key={`${b.key}-${b.season}`}>
          <Link to={`/channel/${b.key}${q}`} className="link-row">
            <span className="w-5 shrink-0 text-center text-sm font-bold text-sub">{i + 1}</span>
            <Avatar src={b.avatar_url} name={b.title} size={56} shape="poster" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{b.title} · Season {b.season}</div>
              <div className="truncate text-xs text-sub">
                {num(b.episodes)} episodes · {b.days === 1 ? date(b.start) : `${date(b.start)} – ${date(b.end)}`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-bold">{b.days === 1 ? "1 day" : `${num(b.days)} days`}</div>
              <div className="text-xs text-sub">{num(Math.round(b.per_day * 10) / 10)}/day</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Episodes vs movies as one whole split in two (tall segmented bar + legend). */
export function KindSplitBar({ split }: { split: KindSplit }) {
  const parts = [
    { key: "episode", label: "Episodes", unit: "shows", color: categorical[0], ...split.episode },
    { key: "movie", label: "Movies", unit: "movies", color: categorical[1], ...split.movie },
  ].filter((p) => p.count > 0);
  const total = parts.reduce((s, p) => s + p.est_s, 0);
  if (!total) return null;
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-xs text-sub">Share of watch time</div>
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded" role="img"
           aria-label={parts.map((p) => `${p.label} ${pct(p.est_s / total)}`).join(", ")}>
        {parts.map((p) => {
          const share = p.est_s / total;
          return (
            <div key={p.key} className="flex h-full items-center rounded px-2 text-xs font-bold text-white"
                 style={{ width: `${share * 100}%`, background: p.color }}>
              {share > 0.1 ? pct(share) : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} · {num(p.count)} {p.key === "episode" ? `from ${num(p.titles)} ${p.titles === 1 ? "show" : p.unit}` : ""} · {duration(p.est_s)}
          </span>
        ))}
      </div>
    </div>
  );
}
