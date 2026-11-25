/* The new home page (YouTube first). Shape for every platform: a hero with the hours and your #1, then the top-10
   row, then the must-have sections (here Evolution and Patterns), then a short strip of nice-to-haves. Our own look:
   ink hero with a warm two-tone backdrop, cream page, mustard / teal / red-orange accents; not the service's UI. */
import { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { HubLink, Link, useCapability } from "../platform";
import { HourPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { ALL_BUCKETS, Bucket, useFilters, useLinkQuery } from "../filters";
import { compact, num } from "../format";
import {
  Comparison, DAYS, Move, changeLine, clockFacts, comparison, hourLabel, hoursShort, longestReign, oneIn, periodTitle, rankMove,
  rankingFilters, spanLabel, topHeadline, weekdayFacts, yearsToShow,
} from "./takeaways";

/** The palette (shared by every platform; only `accent` is the app's own color). */
export const OV = {
  bg: "#F4EEE3", paper: "#FBF6EC", ink: "#1A1714", ink2: "#24201C", soft: "#5C5348", sand: "#E3D8C2",
  mustard: "#E2A93B", teal: "#2E6B63", accent: "#B83A24", mute: "#B9AE9C",
};

interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null } }
interface YearTop { year: number; channel_id: string; title?: string | null; avatar_url?: string | null; time_s: number }
interface ChannelDetail { top_videos: RankedItem[] }

type Tab = [string, string, boolean?];
const TABS: Tab[] = [
  ["/", "Overview", true], ["/top/channels", "Top channels"], ["/evolution", "Evolution"], ["/patterns", "Patterns"],
  ["/records", "Records"],
];
/* nice-to-haves and things people only look for on purpose live behind "More" */
const MORE: [string, string, string?][] = [
  ["/top/videos", "Top videos"], ["/top/genres", "Top genres"], ["/ads", "Ads you saw", "ads"], ["/search", "Search history", "search"],
];

export function OverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const today = meta.data?.today;
  const ov = useStats<Overview>("overview");
  // like Wrapped: rank by what you sat down to watch (Shorts only when that's all you picked), and by hours
  const byTime = { ...rankingFilters(filters), metric: "time" as const };
  const channels = useStats<TopResponse>("top/channels", { limit: 10 }, { filters: byTime });
  // "this year" compares with the same dates last year; other periods use the API's previous period
  const cmp = comparison(filters, today);
  const sameSpan = cmp?.start ? { ...filters, range: "custom", start: cmp.start, end: cmp.end } : null;
  const lastOv = useStats<Overview>("overview", {}, { filters: sameSpan ?? filters, enabled: !!sameSpan });
  const lastTop = useStats<TopResponse>("top/channels", { limit: 200 },
                                        { filters: sameSpan ? { ...byTime, ...sameSpan, metric: "time" } : byTime, enabled: !!sameSpan });
  const prevRank = (c: RankedItem): number | null | undefined => {
    if (!cmp) return undefined;
    if (!sameSpan) return c.prev_rank;
    if (!lastTop.data) return undefined;
    return lastTop.data.items.find((x) => x.key === c.key)?.rank ?? null;
  };
  const prevHours = sameSpan ? lastOv.data?.est_s : ov.data?.previous.est_s;
  const top = channels.data?.items[0];

  return (
    <div className="min-h-[100dvh] font-shelf-sans" style={{ background: OV.bg, color: OV.ink, colorScheme: "light" }}>
      <TopBar />
      {meta.error ? <p className="mx-auto max-w-[1400px] p-6">Can't reach your data. {meta.error.message}</p> : (
        <>
          <Hero o={ov.data} top={top} topLoading={!channels.data} prev={prevHours} cmp={cmp}
                title={periodTitle(filters, today)} topMove={top ? rankMove(1, prevRank(top)) : null} />
          <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
            <TopRow items={channels.data?.items} prevRank={prevRank} cmp={cmp} />
            <Patterns />
            <Evolution />
            <More />
          </main>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ frame

function TopBar() {
  const q = useLinkQuery();
  const { pathname } = useLocation();
  const meta = useMeta().data;
  const thisYear = meta?.today.slice(0, 4);
  const caps = meta?.platform.capabilities;
  const more = MORE.filter(([, , cap]) => !cap || !caps || caps.includes(cap));
  return (
    <header style={{ background: OV.ink, color: OV.paper }}>
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8 lg:h-16 lg:flex-nowrap lg:py-0">
        <HubLink to="/" className="inline-flex min-h-11 items-center font-shelf-mono text-[13px] hover:underline">‹ Shelf</HubLink>
        <span className="font-ov-display text-[26px] font-extrabold tracking-[-0.02em]">{meta?.platform.name ?? "YouTube"}</span>
        <nav aria-label="Sections" className="no-scrollbar order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:overflow-visible lg:px-0">
          {TABS.map(([to, label, end]) => {
            const on = end ? pathname.replace(/\/$/, "").split("/").length <= 2 : pathname.includes(to);
            return (
              <Link key={to} to={to + q} aria-current={on ? "page" : undefined}
                    className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium hover:underline"
                    style={on ? { background: OV.mustard, color: OV.ink } : undefined}>
                {label}
              </Link>
            );
          })}
          {/* phones: the extras are just more tabs in the scrolling row (a dropdown would be clipped there) */}
          {more.map(([to, label]) => (
            <Link key={to} to={to + q} className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium lg:hidden">{label}</Link>
          ))}
          <details className="relative hidden shrink-0 lg:block">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium hover:underline">More ▾</summary>
            <div className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-col rounded-xl border-2 p-1 shadow-xl"
                 style={{ background: OV.paper, color: OV.ink, borderColor: OV.ink }}>
              {more.map(([to, label]) => (
                <Link key={to} to={to + q} className="rounded-lg px-3 py-2.5 text-[14px] hover:bg-black/5">{label}</Link>
              ))}
            </div>
          </details>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PeriodPicker />
          <ContentPicker />
          {thisYear && (
            <Link to={`/wrapped?year=${thisYear}`}
                  className="inline-flex min-h-10 items-center whitespace-nowrap rounded-[10px] px-4 text-[15px] font-bold hover:brightness-105"
                  style={{ background: OV.mustard, color: OV.ink }}>
              Your {thisYear} Wrapped
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

const selectCls = "min-h-10 w-[122px] rounded-[10px] border-2 px-2 font-shelf-mono text-[13px]";
const selectStyle = { borderColor: "#4A433B", background: OV.ink2, color: OV.paper, colorScheme: "dark" as const };

function PeriodPicker() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const [custom, setCustom] = useState(false);
  const years = [...(meta?.years ?? [])].reverse();
  return (
    <div className="relative">
      <label>
        <span className="sr-only">Period</span>
        <select className={selectCls} style={selectStyle} value={filters.range}
                onChange={(e) => (e.target.value === "custom" ? setCustom(true) : update({ range: e.target.value }))}>
          <option value="this_year">This year</option>
          <option value="4w">Past 4 weeks</option>
          <option value="6m">Past 6 months</option>
          <option value="all">Lifetime</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          <option value="custom">{filters.range === "custom" ? `${filters.start} – ${filters.end}` : "Custom…"}</option>
        </select>
      </label>
      {custom && <CustomDates onDone={() => setCustom(false)} min={meta?.first_date} max={meta?.today} />}
    </div>
  );
}

function CustomDates({ onDone, min, max }: { onDone: () => void; min?: string | null; max?: string }) {
  const { filters, update } = useFilters();
  const [start, setStart] = useState(filters.start ?? min ?? "");
  const [end, setEnd] = useState(filters.end ?? max ?? "");
  const input = "mt-1 w-full rounded-lg border-2 px-2 py-1.5 text-sm";
  return (
    <form className="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-2 rounded-xl border-2 p-3 shadow-lg"
          style={{ borderColor: OV.ink, background: OV.paper, color: OV.ink, colorScheme: "light" }}
          onSubmit={(e) => { e.preventDefault(); if (start && end) { update({ range: "custom", start, end }); onDone(); } }}>
      <label className="text-xs">From
        <input type="date" value={start} min={min ?? undefined} max={max} onChange={(e) => setStart(e.target.value)}
               className={input} style={{ borderColor: OV.ink }} />
      </label>
      <label className="text-xs">To
        <input type="date" value={end} min={min ?? undefined} max={max} onChange={(e) => setEnd(e.target.value)}
               className={input} style={{ borderColor: OV.ink }} />
      </label>
      <div className="mt-1 flex gap-2">
        <button type="submit" className="min-h-10 flex-1 rounded-lg font-bold" style={{ background: OV.ink, color: OV.bg }}>Apply</button>
        <button type="button" onClick={onDone} className="min-h-10 flex-1 rounded-lg border-2" style={{ borderColor: OV.ink }}>Cancel</button>
      </div>
    </form>
  );
}

const CONTENT: [string, string, Bucket[]][] = [
  ["all", "All videos", ALL_BUCKETS], ["videos", "Long videos", ["long", "music"]], ["shorts", "Shorts", ["short"]],
];

function ContentPicker() {
  const { filters, update } = useFilters();
  if (!useCapability("shorts")) return null;
  const same = (a: Bucket[], b: Bucket[]) => a.length === b.length && a.every((x) => b.includes(x));
  const current = CONTENT.find(([, , b]) => same(filters.buckets, b))?.[0] ?? "custom";
  return (
    <label>
      <span className="sr-only">Show</span>
      <select className={selectCls} style={selectStyle} value={current}
              onChange={(e) => { const c = CONTENT.find(([k]) => k === e.target.value); if (c) update({ buckets: c[2] }); }}>
        {CONTENT.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        {current === "custom" && <option value="custom">Custom mix</option>}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ small parts

function Pic({ src, size, name, ring = OV.ink }: { src?: string | null; size: string; name?: string | null; ring?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderColor: ring };
  if (!src || failed)
    return <span className="flex shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display font-extrabold"
                 style={{ ...box, background: OV.sand, color: OV.ink }} aria-hidden>{(name ?? "?").charAt(0).toUpperCase()}</span>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
              className="shrink-0 rounded-full border-[3px] object-cover" style={box} />;
}

const MOVE_COLORS: Record<Move["tone"], [string, string]> = {
  up: [OV.teal, OV.paper], new: [OV.mustard, OV.ink], down: [OV.sand, OV.ink], same: [OV.sand, OV.ink],
};

function MoveBadge({ m }: { m: Move | null }) {
  if (!m) return null;
  const [bg, fg] = MOVE_COLORS[m.tone];
  return <span className="w-fit whitespace-nowrap rounded-full px-2 py-px font-shelf-mono text-[11px]" style={{ background: bg, color: fg }}>{m.text}</span>;
}

const kicker = "font-shelf-mono text-[12px] uppercase tracking-[0.12em]";

function Skeleton({ h = 120, dark = false }: { h?: number; dark?: boolean }) {
  return <div className="w-full animate-pulse rounded-xl" style={{ height: h, background: dark ? "rgba(251,246,236,0.08)" : "rgba(26,23,20,0.07)" }} />;
}

/** A section band: kicker, a headline that states the finding, an optional link, then its content. */
function Band({ label, title, link, children }: { label: string; title: ReactNode; link?: [string, string]; children: ReactNode }) {
  const q = useLinkQuery();
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 pb-3" style={{ borderColor: OV.ink }}>
        <div className="flex flex-col gap-1">
          <span className={kicker} style={{ color: OV.soft }}>{label}</span>
          <h2 className="font-ov-display text-[clamp(26px,3vw,38px)] font-extrabold leading-tight tracking-[-0.02em]">{title}</h2>
        </div>
        {link && <Link to={link[0] + q} className="inline-flex min-h-10 items-center font-shelf-mono text-[13px] underline underline-offset-4">{link[1]} ›</Link>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ o, top, topLoading, prev, cmp, title, topMove }: {
  o?: Overview; top?: RankedItem; topLoading: boolean; prev?: number | null; cmp: Comparison | null; title: string; topMove: Move | null;
}) {
  const q = useLinkQuery();
  const meta = useMeta().data;
  const detail = useStats<ChannelDetail>(`channel/${encodeURIComponent(top?.key ?? "")}`, {}, { enabled: !!top, filters: rankingFilters(useFilters().filters) });
  const backdropId = detail.data?.top_videos.find((v) => v.key)?.key;
  const hours = o ? Math.round(o.est_s / 3600) : null;
  const change = o && cmp ? changeLine(o.est_s, prev, cmp.label) : null;
  const n = o ? o.split.long.videos + o.split.short.videos + o.split.music.videos + o.split.unknown.videos : 0;
  const longShare = o && n ? (o.split.long.videos + o.split.music.videos) / n : 0;
  const shortShare = o && n ? o.split.short.videos / n : 0;
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      {/* warm two-tone backdrop: your #1's most-watched video, in red-orange and ink */}
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 30%, ${OV.accent} 140%)` }}>
        {/* keyed by video, so a new period or a new #1 swaps the picture (it remembers its fallback otherwise) */}
        {backdropId && <Backdrop key={backdropId} id={backdropId} />}
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${OV.ink} 0%, ${OV.ink}ee 38%, ${OV.ink}55 70%, ${OV.ink}22 100%)` }} />
      <div className="relative mx-auto flex min-h-[clamp(420px,62vh,640px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[640px] flex-col gap-5">
          <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "YouTube"} · {title}</span>
          {o && hours != null ? (
            <>
              <h1 className="flex items-baseline gap-4 font-ov-display font-extrabold leading-[0.82]">
                <span className="text-[clamp(96px,13vw,190px)] tracking-[-0.05em]" style={{ color: OV.mustard }}>{num(hours)}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-[clamp(26px,2.6vw,38px)]">hours</span>
                  <span className="font-shelf-mono text-[12px] font-normal" style={{ color: OV.mute }}>estimated</span>
                </span>
              </h1>
              {change && <p className="text-[18px]">{change}</p>}
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Stat v={compact(o.videos)} l="videos" />
                <Stat v={compact(o.unique_channels)} l="channels" />
                <Stat v={num(o.active_days)} l={`of ${num(o.days)} days`} />
                <Stat v={`${Math.round(o.pct_days_active * 100)}%`} l="of days watched" />
              </dl>
              {shortShare > 0 && longShare > 0 && (
                <div className="flex max-w-[520px] flex-col gap-1.5" role="img"
                     aria-label={`${Math.round(longShare * 100)}% long videos, ${Math.round(shortShare * 100)}% Shorts`}>
                  <span className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "#4A433B" }}>
                    <span style={{ width: `${longShare * 100}%`, background: OV.mustard }} />
                    <span style={{ width: `${shortShare * 100}%`, background: OV.paper }} />
                  </span>
                  <span className="flex justify-between font-shelf-mono text-[12px]" style={{ color: OV.mute }}>
                    <span><span style={{ color: OV.mustard }}>■</span> {Math.round(longShare * 100)}% long videos · {num(o.split.long.videos + o.split.music.videos)}</span>
                    <span><span style={{ color: OV.paper }}>■</span> {Math.round(shortShare * 100)}% Shorts · {num(o.split.short.videos)}</span>
                  </span>
                </div>
              )}
            </>
          ) : <Skeleton h={260} dark />}
        </div>
        <div className="shrink-0 lg:w-[300px]">
          {top ? (
            <Link to={`/channel/${encodeURIComponent(top.key)}${q}`} className="group flex items-center gap-5 lg:flex-col lg:items-start">
              <span className="relative">
                <Pic src={top.avatar_url} name={top.title} size="clamp(110px,14vw,200px)" ring={OV.paper} />
                <span className="absolute -right-2 top-1 flex h-14 w-14 rotate-6 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                      style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }} aria-hidden>#1</span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className={kicker} style={{ color: OV.mustard }}>Your #1 channel</span>
                <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">
                  {topHeadline(top.title, topMove?.tone === "same" ? 1 : undefined)}
                </span>
                <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{hoursShort(top.time_s)} · {num(top.count)} videos</span>
              </span>
            </Link>
          ) : topLoading ? <Skeleton h={200} dark /> : null}
        </div>
      </div>
    </section>
  );
}

function Backdrop({ id }: { id: string }) {
  const [src, setSrc] = useState(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
  return (
    <img src={src} alt="" referrerPolicy="no-referrer" className="absolute inset-y-0 right-0 h-full w-full object-cover lg:w-[70%]"
         style={{ filter: "grayscale(1) contrast(1.15)", mixBlendMode: "multiply", opacity: 0.9 }}
         onError={() => setSrc(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`)} />
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{l}</dt>
      <dd className="order-1 font-ov-display text-[30px] font-extrabold leading-tight">{v}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ sections

function TopRow({ items, prevRank, cmp }: {
  items?: RankedItem[]; prevRank: (c: RankedItem) => number | null | undefined; cmp: Comparison | null;
}) {
  const q = useLinkQuery();
  return (
    <Band label={`By hours watched${cmp ? ` · arrows since ${cmp.label}` : ""}`} title="Your top 10 channels" link={["/top/channels", "All your channels"]}>
      {!items ? <Skeleton h={220} /> : !items.length ? <p style={{ color: OV.soft }}>No channels in this period.</p> : (
        // keyed by the period: a remount starts the row at #1 (scroll snapping would otherwise keep the old position)
        <ol key={q} className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-10 lg:overflow-visible">
          {items.map((c) => (
            <li key={c.key} className="w-[150px] shrink-0 snap-start lg:w-auto lg:min-w-0">
              <Link to={`/channel/${encodeURIComponent(c.key)}${q}`} className="group flex flex-col items-start gap-2">
                <span className="relative">
                  <Pic src={c.avatar_url} name={c.title} size="clamp(64px,7.6vw,112px)" />
                  <span className="absolute -left-1 -top-1 flex h-10 w-10 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                        style={{ background: c.rank === 1 ? OV.mustard : OV.paper, borderColor: OV.ink }} aria-hidden>{c.rank}</span>
                </span>
                <span className="w-full truncate text-[16px] font-bold group-hover:underline">{c.title}</span>
                <span className="flex flex-col"><span className="font-ov-display text-[17px] font-extrabold leading-tight">{hoursShort(c.time_s)}</span>
                  <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{num(c.count)} videos</span></span>
                <MoveBadge m={rankMove(c.rank, prevRank(c))} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Band>
  );
}

function Evolution() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  // only for long periods: one year already has a single #1 (the hero shows it)
  const years = yearsToShow(filters, meta?.first_date, meta?.today);
  const all = { ...rankingFilters(filters), range: "all", metric: "time" as const };
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: all, enabled: !!years });
  if (!years) return null;
  const rows = tops.data?.filter((t) => years.includes(t.year));
  const reign = rows ? longestReign(rows) : null;
  const thisYear = Number(meta?.today.slice(0, 4));
  const title = reign && reign.years >= 2 ? `${reign.title} was your #1 ${reign.years} years running.` : "A different #1 almost every year.";
  return (
    <Band label="Your #1 channel each year" title={title} link={["/evolution", "See how it changed"]}>
      {/* about the channels: each year's hours here are that channel's, never your total */}
      {!rows ? <Skeleton h={160} /> : (
        <>
          <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ol className="grid min-w-[560px] gap-3" style={{ gridTemplateColumns: `repeat(${rows.length},minmax(0,1fr))` }}>
              {rows.map((t) => {
                const now = t.year === thisYear;
                return (
                  <li key={t.year} className="min-w-0">
                    <Link to={`/wrapped?year=${t.year}`} className="group flex h-full flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center hover:bg-black/[0.03]"
                          style={{ borderColor: now ? OV.mustard : "#D9CDB6" }}
                          aria-label={`${t.year}: your #1 was ${t.title ?? "unknown"}, ${hoursShort(t.time_s)}${now ? " so far" : ""}. Open ${t.year} Wrapped`}>
                      <span className="font-shelf-mono text-[12px] font-medium">{t.year}{now ? " so far" : ""}</span>
                      <Pic src={t.avatar_url} name={t.title} size="56px" />
                      <span className="w-full truncate text-[13px] font-bold group-hover:underline">{t.title}</span>
                      <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{hoursShort(t.time_s)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
            Hours are what you watched of that channel that year{filters.range === "custom" ? " (whole calendar years)" : ""}. Pick a year to open its Wrapped.
          </p>
        </>
      )}
    </Band>
  );
}
function Patterns() {
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const heat = useStats<{ data: { count: number[][] } }>("patterns/heatmap");
  const f = clock.data ? clockFacts(clock.data.data) : null;
  const w = heat.data ? weekdayFacts(heat.data.data.count) : null;
  const max = clock.data ? Math.max(1, ...clock.data.data.map((h) => h.count)) : 1;
  const wmax = w ? Math.max(1, ...w.totals) : 1;
  const title = f ? (f.night >= 0.2 ? "Up past midnight." : `Most of it around ${hourLabel(f.peak)}.`) : "When you watch";
  return (
    <Band label="Patterns · when you watch" title={title} link={["/patterns", "All your patterns"]}>
      {!clock.data ? <Skeleton h={240} /> : !f ? <p style={{ color: OV.soft }}>No watches in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <figure className="flex flex-col gap-3 rounded-2xl p-5" style={{ background: OV.ink, color: OV.paper }}
                  aria-label={`Videos started by hour. Busiest: ${hourLabel(f.peak)}.`}>
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <span><span className="font-ov-display text-[28px] font-extrabold" style={{ color: OV.mustard }}>{hourLabel(f.peak)}</span>
                <span className="ml-2 text-[15px]">is your busiest hour</span></span>
              <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{oneIn(f.night)} videos started after midnight</span>
            </figcaption>
            <div aria-hidden className="grid h-[150px] items-end gap-[3px]" style={{ gridTemplateColumns: "repeat(24,minmax(0,1fr))" }}>
              {clock.data.data.map((h) => (
                <span key={h.hour} className="rounded-t-[3px]"
                      style={{ height: `${Math.max(3, (h.count / max) * 100)}%`, background: h.hour === f.peak ? OV.mustard : h.hour < 5 ? "#8E8170" : "#5E554A" }} />
              ))}
            </div>
            <div aria-hidden className="grid font-shelf-mono text-[11px]" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", color: OV.mute }}>
              <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span>
            </div>
          </figure>
          <figure className="flex flex-col gap-3 rounded-2xl border-2 p-5" style={{ background: OV.paper, borderColor: OV.ink }}
                  aria-label={w ? `Videos by day of the week. Busiest: ${w.busiest}.` : "Videos by day of the week"}>
            <figcaption>
              <span className="font-ov-display text-[28px] font-extrabold">{w?.busiest ?? "…"}</span>
              <span className="ml-2 text-[15px]">is your busiest day</span>
            </figcaption>
            {w ? (
              <div className="grid flex-1 grid-cols-7 items-end gap-2">
                {w.totals.map((t, i) => (
                  <span key={i} className="flex h-full min-h-[120px] flex-col justify-end gap-1">
                    <span className="block rounded-t-md border-2"
                          style={{ height: `${Math.max(4, (t / wmax) * 100)}%`, borderColor: OV.ink, background: t === wmax ? OV.teal : OV.sand }} />
                    <span className="text-center font-shelf-mono text-[11px]">{DAYS[i]}</span>
                  </span>
                ))}
              </div>
            ) : <Skeleton h={120} />}
          </figure>
        </div>
      )}
    </Band>
  );
}

function More() {
  const { filters } = useFilters();
  const videos = useStats<TopResponse>("top/videos", { limit: 10 }, { filters: rankingFilters(filters) });
  const genre = useStats<TopResponse>("top/genres", { limit: 1 });
  const records = useStats<RecordsResponse>("records");
  const v = videos.data?.items.find((x) => x.title);
  const g = genre.data?.items[0];
  const s = records.data?.streaks.longest;
  return (
    <Band label="More to explore" title="A few more things">
      <div className="grid gap-4 sm:grid-cols-3">
        <MoreCard to="/top/videos" label="Top videos" bg={OV.paper}>
          {v ? (
            <div className="flex items-center gap-3">
              <img src={v.thumb ?? `https://i.ytimg.com/vi/${v.key}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer"
                   className="aspect-video w-[120px] shrink-0 rounded-md border-2 object-cover" style={{ borderColor: OV.ink }} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-ov-display text-[22px] font-extrabold">{num(v.count)}× </span>
                <span className="line-clamp-2 text-[14px] font-bold leading-snug">{v.title}</span>
              </span>
            </div>
          ) : <Skeleton h={68} />}
        </MoreCard>
        <MoreCard to="/top/genres" label="Top genres" bg={OV.mustard}>
          {g ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{g.title}</span>
              <span className="text-[14px]">in {Math.round(g.share * 100)}% of what you watched</span>
            </span>
          ) : <Skeleton h={68} />}
        </MoreCard>
        <MoreCard to="/records" label="Records" bg={OV.teal} fg={OV.paper}>
          {records.data === undefined ? <Skeleton h={68} /> : s ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{num(s.days)} days in a row</span>
              <span className="text-[14px]">{spanLabel(s.start, s.end)}, your longest streak</span>
            </span>
          ) : <span className="text-[14px]">Not enough data yet.</span>}
        </MoreCard>
      </div>
    </Band>
  );
}

function MoreCard({ to, label, bg, fg = OV.ink, children }: { to: string; label: string; bg: string; fg?: string; children: ReactNode }) {
  const q = useLinkQuery();
  return (
    <Link to={to + q} className="flex flex-col gap-3 rounded-2xl border-2 p-5 transition-transform hover:-translate-y-0.5"
          style={{ background: bg, color: fg, borderColor: OV.ink }}>
      <span className="flex items-center justify-between"><span className={kicker}>{label}</span><span aria-hidden>›</span></span>
      {children}
    </Link>
  );
}
