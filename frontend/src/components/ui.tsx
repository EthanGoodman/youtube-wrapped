import { ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Info, Minus } from "lucide-react";
import { ApiError, useMeta } from "../api";
import { duration } from "../format";
import { useLinkQuery } from "../filters";

export function Section({ title, subtitle, action, children, className = "" }: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-sub">{subtitle}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function SeeAll({ to }: { to: string }) {
  const q = useLinkQuery();
  return (
    <Link to={to + q} className="text-sm font-medium text-sub hover:text-ink">
      See all ›
    </Link>
  );
}

/** Stat tile: label, value, optional delta vs the previous period. */
export function StatTile({ label, value, unit, delta, hint, info }: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: number | null;
  hint?: ReactNode;
  info?: ReactNode;
}) {
  return (
    <div className="rounded-card bg-raised/60 p-3 sm:p-4">
      <div className="flex items-center gap-1 text-xs font-medium text-sub sm:text-sm">
        {label}
        {info}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold sm:text-3xl">{value}</span>
        {unit && <span className="text-sm text-sub">{unit}</span>}
      </div>
      {delta !== undefined && <Delta value={delta} />}
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Delta({ value, suffix = "vs previous period" }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return <div className="mt-0.5 text-xs text-muted">no earlier data</div>;
  const v = Math.round(value * 100);
  const Icon = v > 0 ? ArrowUp : v < 0 ? ArrowDown : Minus;
  const color = v > 0 ? "text-up" : v < 0 ? "text-down" : "text-sub";
  return (
    <div className="mt-0.5 flex items-center gap-1 text-xs">
      <span className={`flex items-center font-medium ${color}`}>
        <Icon size={12} strokeWidth={3} aria-hidden />
        {Math.abs(v)}%
      </span>
      <span className="text-muted">{suffix}</span>
    </div>
  );
}

/** stats.fm-style rank movement: green up, red down, NEW for unranked before. */
export function RankChange({ change }: { change: number | null | undefined }) {
  if (change == null)
    return <span className="rounded bg-yt/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-yt-soft">NEW</span>;
  if (change === 0) return <Minus size={14} className="text-muted" aria-label="same rank" />;
  const up = change > 0;
  return (
    <span className={`flex items-center text-xs font-bold ${up ? "text-up" : "text-down"}`}
          aria-label={`${up ? "up" : "down"} ${Math.abs(change)}`}>
      {up ? <ArrowUp size={12} strokeWidth={3} /> : <ArrowDown size={12} strokeWidth={3} />}
      {Math.abs(change)}
    </span>
  );
}

export function Avatar({ src, name, size = 48, className = "" }: {
  src?: string | null; name?: string | null; size?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (!src || failed)
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-full bg-raised font-bold text-sub ${className}`}
           style={{ width: size, height: size, fontSize: size * 0.4 }}>{initial}</div>
    );
  return (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
         className={`shrink-0 rounded-full bg-raised object-cover ${className}`} style={{ width: size, height: size }} />
  );
}

/** Video thumbnail; Shorts get a 9:16 crop. */
export function Thumb({ src, videoId, short = false, width = 120, className = "" }: {
  src?: string | null; videoId?: string | null; short?: boolean; width?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = src ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null);
  // same row height for both; a Short is a 9:16 crop of it
  const height = Math.round(width * (9 / 16));
  const style = { width: short ? Math.round(height * (9 / 16)) : width, height };
  if (!url || failed) return <div className={`shrink-0 rounded-lg bg-raised ${className}`} style={style} />;
  return (
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
         className={`shrink-0 rounded-lg bg-raised object-cover ${className}`} style={style} />
  );
}

/** Small ⓘ that explains how watch time is estimated. Click/tap or hover to open. */
export function WatchTimeInfo() {
  const meta = useMeta().data;
  const w = meta?.watchtime;
  return (
    <InfoTip label="How watch time is estimated">
      <p className="font-medium text-ink">This is an estimate, not an exact number.</p>
      <p className="mt-1">
        Google Takeout only records when a video <em>started</em>. Each video counts as the shorter of its length and
        the time until the next video.
      </p>
      <p className="mt-1">
        When the next video is more than {w?.session_gap_minutes ?? 30} min later, the session ended: the full length
        counts, up to {duration(w?.max_seconds_per_video ?? 10800)}. Deleted and live videos with unknown length count
        up to {duration(w?.unknown_duration_fallback_seconds ?? 600)}.
      </p>
      <p className="mt-1">
        Ads are ignored. Sleep/background audio is left out of time by default (settings ⚙). “Max possible” adds up
        full video lengths (each capped at {duration(w?.max_possible_cap_seconds ?? 43200)}).
      </p>
    </InfoTip>
  );
}

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}
              className="text-muted hover:text-ink">
        <Info size={14} />
      </button>
      {open && (
        <span role="tooltip"
              className="absolute left-1/2 top-6 z-50 w-72 -translate-x-1/2 rounded-lg border border-line bg-[#282828] p-3 text-left text-xs font-normal leading-relaxed text-sub shadow-xl">
          {children}
        </span>
      )}
    </span>
  );
}

export function MetricToggle({ value, onChange }: { value: "count" | "time"; onChange: (v: "count" | "time") => void }) {
  return (
    <div className="seg" role="group" aria-label="Rank by">
      <button aria-pressed={value === "count"} onClick={() => onChange("count")}>Videos</button>
      <button aria-pressed={value === "time"} onClick={() => onChange("time")}>Time</button>
    </div>
  );
}

/** Loading / error / empty wrapper. While refetching it keeps the old content, dimmed. */
export function QueryState<T>({ q, children, empty, minHeight = 120 }: {
  q: { data?: T; error: ApiError | null; isLoading: boolean; isPlaceholderData?: boolean };
  children: (data: T) => ReactNode;
  empty?: (data: T) => boolean;
  minHeight?: number;
}) {
  if (q.error)
    return (
      <div className="rounded-lg bg-down/10 p-3 text-sm text-down">
        Couldn't load this: {q.error.message}
      </div>
    );
  if (q.isLoading || q.data === undefined)
    return <div className="animate-pulse rounded-lg bg-raised/50" style={{ minHeight }} />;
  if (empty?.(q.data)) return <div className="py-6 text-center text-sm text-muted">Nothing here for this period.</div>;
  return <div className={q.isPlaceholderData ? "refetching" : ""}>{children(q.data)}</div>;
}

export function PageTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="px-1">
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-sub">{subtitle}</p>}
    </div>
  );
}
