/* The new Overview (YouTube first): one screen with the answers most people want. Our own look (cream, ink-outlined
   cards, one loud app color), not the service's UI. On laptops everything fits the window; phones stack and scroll. */
import { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { HubLink, Link, useCapability } from "../platform";
import { HourPoint, MonthPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { ALL_BUCKETS, Bucket, useFilters, useLinkQuery } from "../filters";
import { compact, num } from "../format";
import {
  Comparison, Move, changeLine, clockFacts, clockLine, comparison, hourLabel, hoursShort, periodTitle, periodYear, rankMove,
  rankingFilters, spanLabel, topHeadline, yearlyHours,
} from "./takeaways";

/** The palette (shared by every platform; only `accent` is the app's own color). */
export const OV = {
  bg: "#F4EEE3", paper: "#FBF6EC", ink: "#1A1714", soft: "#5C5348", sand: "#E3D8C2",
  mustard: "#E2A93B", teal: "#2E6B63", accent: "#B83A24",
};

interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null } }

const TABS: [string, string, boolean?][] = [
  ["/", "Overview", true], ["/top/channels", "Favorites"], ["/patterns", "When you watch"],
  ["/top/genres", "What you watch"], ["/records", "Records"], ["/evolution", "Over the years"],
];

/* On laptops (wide and at least 600px tall) the page is exactly one window tall; below that it scrolls. Tailwind needs these
   classes written out in full, so the media query is repeated in `main` below. */

export function OverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const ov = useStats<Overview>("overview");
  // like Wrapped: rank channels and videos by what you sat down to watch, so a pile of 20-second Shorts doesn't
  // outrank them (when you pick Shorts only, Shorts it is)
  const ranked = rankingFilters(filters);
  // channels are ranked by hours, the number they show most
  const byTime = { ...ranked, metric: "time" as const };
  const channels = useStats<TopResponse>("top/channels", { limit: 5 }, { filters: byTime });
  // "this year" compares with the same dates last year; other periods use the API's previous period
  const cmp = comparison(filters, meta.data?.today);
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
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const records = useStats<RecordsResponse>("records");
  const videos = useStats<TopResponse>("top/videos", { limit: 10 }, { filters: ranked });
  const video = videos.data ? videos.data.items.find((v) => v.title) ?? null : undefined;
  const genre = useStats<TopResponse>("top/genres", { limit: 1 });
  const months = useStats<{ data: MonthPoint[] }>("patterns/monthly", {}, { filters: { ...filters, range: "all" } });
  const year = periodYear(filters.range, meta.data?.today);

  return (
    <div className="min-h-[100dvh] font-shelf-sans" style={{ background: OV.bg, color: OV.ink, colorScheme: "light" }}>
      <TopBar />
      {meta.error ? (
        <p className="mx-auto max-w-[1400px] p-6">Can't reach your data. {meta.error.message}</p>
      ) : (
        <main className={`mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-3 sm:px-6 [@media(min-height:760px)]:gap-3.5 [@media(min-height:760px)]:py-4 [@media(min-width:1024px)_and_(min-height:600px)]:grid [@media(min-width:1024px)_and_(min-height:600px)]:h-[calc(100dvh-66px)] [@media(min-width:1024px)_and_(min-height:600px)]:grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)_auto]`}>
          <div className={`flex min-h-0 flex-col gap-3.5 lg:flex-row`}>
            <HoursCard o={ov.data} prev={prevHours} cmp={cmp} />
            <TopChannels items={channels.data?.items} prevRank={prevRank} cmp={cmp} />
          </div>
          <div className="grid min-h-0 grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <WhenCard clock={clock.data?.data} />
            <WhatCard o={ov.data} genre={genre.data?.items[0]} />
            <RecordsCard streak={records.data?.streaks.longest} />
            <RepeatCard v={video} />
          </div>
          <YearsStrip months={months.data?.data} current={year} />
        </main>
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
  return (
    <header className="border-b-2" style={{ borderColor: OV.ink, background: OV.bg }}>
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:h-16 lg:flex-nowrap lg:py-0">
        <HubLink to="/" className="inline-flex min-h-11 items-center font-shelf-mono text-[13px] hover:underline">‹ Shelf</HubLink>
        <span className="font-ov-display text-[26px] font-extrabold tracking-[-0.02em]">{meta?.platform.name ?? "YouTube"}</span>
        <nav aria-label="Sections" className="no-scrollbar order-last -mx-1 flex w-full gap-1 overflow-x-auto px-1 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:px-0">
          {TABS.map(([to, label, end]) => {
            const on = end ? pathname.replace(/\/$/, "").split("/").length <= 2 : pathname.includes(to);
            return (
              <Link key={to} to={to + q} aria-current={on ? "page" : undefined}
                    className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium"
                    style={on ? { background: OV.ink, color: OV.bg } : undefined}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PeriodPicker />
          <ContentPicker />
          {thisYear && (
            <Link to={`/wrapped?year=${thisYear}`}
                  className="inline-flex min-h-10 items-center whitespace-nowrap rounded-[10px] border-2 px-4 text-[15px] font-bold hover:brightness-95"
                  style={{ borderColor: OV.ink, background: OV.mustard }}>
              Your {thisYear} Wrapped
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

const selectCls = "min-h-10 w-[122px] rounded-[10px] border-2 px-2 font-shelf-mono text-[13px]";

function PeriodPicker() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const [custom, setCustom] = useState(false);
  const years = [...(meta?.years ?? [])].reverse();
  return (
    <div className="relative">
      <label>
        <span className="sr-only">Period</span>
        <select className={selectCls} style={{ borderColor: OV.ink, background: OV.bg, color: OV.ink }}
                value={filters.range}
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
          style={{ borderColor: OV.ink, background: OV.paper }}
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
      <select className={selectCls} style={{ borderColor: OV.ink, background: OV.bg, color: OV.ink }} value={current}
              onChange={(e) => { const c = CONTENT.find(([k]) => k === e.target.value); if (c) update({ buckets: c[2] }); }}>
        {CONTENT.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        {current === "custom" && <option value="custom">Custom mix</option>}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ cards

function Card({ children, bg = OV.paper, fg = OV.ink, className = "", to }: {
  children: ReactNode; bg?: string; fg?: string; className?: string; to?: string;
}) {
  const q = useLinkQuery();
  const cls = `flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 ${className}`;
  const style = { background: bg, color: fg, borderColor: OV.ink };
  return to
    ? <Link to={to + q} className={`${cls} transition-transform hover:-translate-y-0.5`} style={style}>{children}</Link>
    : <section className={cls} style={style}>{children}</section>;
}

const kicker = "font-shelf-mono text-[12px] uppercase tracking-[0.1em]";
const big = "font-ov-display font-extrabold leading-[0.95] text-[clamp(26px,4.6vh,44px)]";

function Pill({ children, bg, fg }: { children: ReactNode; bg: string; fg: string }) {
  return <span className="whitespace-nowrap rounded-full px-2.5 py-1 font-shelf-mono text-[12px]" style={{ background: bg, color: fg }}>{children}</span>;
}

function Skeleton() {
  return <div className="h-full min-h-24 animate-pulse rounded-xl" style={{ background: "rgba(26,23,20,0.08)" }} />;
}

function HoursCard({ o, prev, cmp }: { o?: Overview; prev?: number | null; cmp: Comparison | null }) {
  const { filters } = useFilters();
  const today = useMeta().data?.today;
  const hours = o ? Math.round(o.est_s / 3600) : null;
  const change = o && cmp ? changeLine(o.est_s, prev, cmp.label) : null;
  return (
    <Card bg={OV.accent} fg={OV.paper} className="shrink-0 gap-2 p-5 lg:basis-[34%] [@media(min-height:760px)]:p-7">
      <span className={kicker}>{periodTitle(filters, today)}</span>
      {o && hours != null ? (
        <>
          <h1 className="flex items-baseline gap-3 font-ov-display font-extrabold leading-[0.85]">
            <span className="text-[clamp(56px,12vh,170px)] tracking-[-0.04em]">{num(hours)}</span>
            <span className="text-[clamp(22px,3.4vh,32px)]">hours</span>
          </h1>
          <p className="max-w-[440px] text-[clamp(15px,2.3vh,22px)] leading-snug">
            On {num(o.active_days)} days.{change ? ` ${change}` : ""}
          </p>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Pill bg={OV.paper} fg={OV.ink}>{compact(o.videos)} videos</Pill>
            <Pill bg={OV.paper} fg={OV.ink}>{compact(o.unique_channels)} channels</Pill>
          </div>
        </>
      ) : <Skeleton />}
    </Card>
  );
}

function Pic({ src, size, name }: { src?: string | null; size: string; name?: string | null }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderColor: OV.ink };
  if (!src || failed)
    return <span className="flex shrink-0 items-center justify-center rounded-full border-2 font-ov-display font-extrabold"
                 style={{ ...box, background: OV.sand }} aria-hidden>{(name ?? "?").charAt(0).toUpperCase()}</span>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
              className="shrink-0 rounded-full border-2 object-cover" style={box} />;
}

const MOVE_COLORS: Record<Move["tone"], [string, string]> = {
  up: [OV.teal, OV.paper], new: [OV.mustard, OV.ink], down: [OV.sand, OV.ink], same: [OV.sand, OV.ink],
};

function MoveBadge({ m }: { m: Move | null }) {
  if (!m) return null;
  const [bg, fg] = MOVE_COLORS[m.tone];
  return <span className="w-fit whitespace-nowrap rounded-full px-2 py-px font-shelf-mono text-[11px]" style={{ background: bg, color: fg }}>{m.text}</span>;
}

function TopChannels({ items, prevRank, cmp }: {
  items?: RankedItem[]; prevRank: (c: RankedItem) => number | null | undefined; cmp: Comparison | null;
}) {
  const q = useLinkQuery();
  const [top, ...rest] = items ?? [];
  return (
    <Card className="min-w-0 flex-1 gap-3 p-5 [@media(min-height:760px)]:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="font-ov-display text-[clamp(20px,3vh,26px)] font-extrabold tracking-[-0.01em]">
          {top ? topHeadline(top.title, prevRank(top)) : "Your top channels"}
        </h2>
        {top && (
          <p className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>
            By hours watched{cmp ? ` · arrows: since ${cmp.label}` : ""}
          </p>
        )}
        <Link to={"/top/channels" + q} className="ml-auto inline-flex min-h-10 items-center font-shelf-mono text-[13px] underline underline-offset-4">All your channels ›</Link>
      </div>
      {!items ? <Skeleton /> : !top ? <p style={{ color: OV.soft }}>No channels in this period.</p> : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
          <Link to={`/channel/${encodeURIComponent(top.key)}${q}`} className="flex shrink-0 flex-col justify-center gap-1.5 sm:w-[clamp(140px,22vh,260px)]">
            <span className="relative w-fit">
              <Pic src={top.avatar_url} name={top.title} size="clamp(72px,15vh,210px)" />
              <span className="absolute -right-1 top-0 flex h-[clamp(34px,5.5vh,50px)] w-[clamp(34px,5.5vh,50px)] items-center justify-center rounded-full border-2 font-ov-display text-[clamp(14px,2.2vh,20px)] font-extrabold"
                    style={{ background: OV.mustard, borderColor: OV.ink }} aria-hidden>1</span>
            </span>
            <span className="font-ov-display text-[clamp(20px,3vh,26px)] font-extrabold leading-tight">{top.title}</span>
            <span className="font-shelf-mono text-[13px]" style={{ color: OV.soft }}>{hoursShort(top.time_s)} · {num(top.count)} videos</span>
          </Link>
          <ol start={2} className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 sm:grid-rows-2">
            {rest.map((c) => {
              return (
                <li key={c.key} className="min-h-0">
                  <Link to={`/channel/${encodeURIComponent(c.key)}${q}`} className="flex h-full items-center gap-3 rounded-xl p-2.5 hover:brightness-[0.97]" style={{ background: OV.bg }}>
                    <Pic src={c.avatar_url} name={c.title} size="clamp(40px,7vh,88px)" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[clamp(15px,2.1vh,20px)] font-bold">{c.rank}. {c.title}</span>
                      <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{hoursShort(c.time_s)} · {num(c.count)} videos</span>
                      <MoveBadge m={rankMove(c.rank, prevRank(c))} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

function SmallCard({ label, bg, fg, labelColor, to, children }: {
  label: string; bg: string; fg: string; labelColor?: string; to: string; children: ReactNode;
}) {
  return (
    <Card bg={bg} fg={fg} to={to} className="gap-1.5 p-4 [@media(min-height:760px)]:p-5">
      <span className="flex items-center justify-between">
        <span className={kicker} style={{ color: labelColor }}>{label}</span>
        <span aria-hidden className="font-shelf-mono text-[13px]">›</span>
      </span>
      {children}
    </Card>
  );
}

const line = "line-clamp-2 text-[clamp(13px,1.9vh,16px)] leading-snug";

function WhenCard({ clock }: { clock?: HourPoint[] }) {
  const f = clock ? clockFacts(clock) : null;
  const max = clock ? Math.max(1, ...clock.map((h) => h.count)) : 1;
  return (
    <SmallCard label="When you watch" bg={OV.ink} fg={OV.paper} labelColor={OV.mustard} to="/patterns">
      {!clock ? <Skeleton /> : !f ? <p className={line}>No watches in this period.</p> : (
        <>
          <span className={big}>{hourLabel(f.peak)}</span>
          <span className={line}>{clockLine(f)}</span>
          <span aria-hidden className="mt-auto grid h-[clamp(18px,4.2vh,40px)] items-end gap-[2px]" style={{ gridTemplateColumns: "repeat(24,minmax(0,1fr))" }}>
            {clock.map((h) => (
              <span key={h.hour} className="rounded-[2px]"
                    style={{ height: `${Math.max(4, (h.count / max) * 100)}%`, background: h.hour === f.peak ? OV.mustard : "#6E6558" }} />
            ))}
          </span>
          <span aria-hidden className="grid font-shelf-mono text-[10px]" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", color: "#B9AE9C" }}>
            <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span>
          </span>
        </>
      )}
    </SmallCard>
  );
}

function SplitBar({ share, label }: { share: number; label?: string }) {
  const bar = (
    <span className="flex h-3 flex-1 overflow-hidden rounded-md border-2" style={{ borderColor: OV.ink }}>
      <span style={{ width: `${share * 100}%`, background: OV.ink }} />
      <span className="flex-1" style={{ background: OV.paper }} />
    </span>
  );
  if (!label) return bar;
  return (
    <span className="flex items-center gap-2 font-shelf-mono text-[11px]">
      <span className="w-[44px] uppercase tracking-[0.06em]">{label}</span>{bar}<span className="w-[30px] text-right">{Math.round(share * 100)}%</span>
    </span>
  );
}

function WhatCard({ o, genre }: { o?: Overview; genre?: RankedItem }) {
  if (!o) return <SmallCard label="What you watch" bg={OV.mustard} fg={OV.ink} to="/top/genres"><Skeleton /></SmallCard>;
  const n = o.split.long.videos + o.split.short.videos + o.split.music.videos + o.split.unknown.videos;
  const shortShare = n ? o.split.short.videos / n : 0;
  const shortTime = o.est_s ? o.split.short.est_s / o.est_s : 0;
  const both = o.split.short.videos > 0 && o.split.long.videos > 0;
  return (
    <SmallCard label="What you watch" bg={OV.mustard} fg={OV.ink} to="/top/genres">
      {both ? (
        <>
          <span className={big}>{Math.round(shortShare * 100)}% Shorts</span>
          <span className={line}>
            of your videos, {shortTime < shortShare ? "but only" : "and"} {Math.round(shortTime * 100)}% of your watch time.
          </span>
          <span className="mt-auto flex flex-col gap-1" role="img"
                aria-label={`Shorts: ${Math.round(shortShare * 100)}% of videos, ${Math.round(shortTime * 100)}% of watch time`}>
            <SplitBar share={shortShare} label="Videos" /><SplitBar share={shortTime} label="Time" />
          </span>
        </>
      ) : genre ? (
        <>
          <span className={big}>{genre.title}</span>
          <span className={line}>was your top topic, in {Math.round(genre.share * 100)}% of what you watched.</span>
          <span aria-hidden className="mt-auto"><SplitBar share={genre.share} /></span>
        </>
      ) : <p className={line}>Not enough data yet.</p>}
    </SmallCard>
  );
}

function RecordsCard({ streak }: { streak?: Streak | null }) {
  const cells = 28;
  return (
    <SmallCard label="Records" bg={OV.teal} fg={OV.paper} to="/records">
      {streak === undefined ? <Skeleton /> : !streak ? <p className={line}>Not enough data yet.</p> : (
        <>
          <span className={big}>{num(streak.days)} {streak.days === 1 ? "day" : "days"}</span>
          <span className={line}>in a row, {spanLabel(streak.start, streak.end)}. Your longest streak.</span>
          <span aria-hidden className="mt-auto grid gap-[3px]" style={{ gridTemplateColumns: "repeat(14,minmax(0,1fr))" }}>
            {Array.from({ length: cells }, (_, i) => (
              <span key={i} className="aspect-square max-h-[clamp(8px,1.6vh,14px)] rounded-[2px]"
                    style={{ background: i < Math.min(streak.days, cells) ? OV.mustard : "rgba(251,246,236,0.25)" }} />
            ))}
          </span>
        </>
      )}
    </SmallCard>
  );
}

function RepeatCard({ v }: { v?: RankedItem | null }) {
  const thumb = v ? v.thumb ?? `https://i.ytimg.com/vi/${v.key}/mqdefault.jpg` : null;
  return (
    <SmallCard label="On repeat" bg={OV.paper} fg={OV.ink} labelColor={OV.soft} to="/top/videos">
      {v === undefined ? <Skeleton /> : !v ? <p className={line}>Not enough data yet.</p> : (
        <>
          <span className={big}>{v.count > 1 ? `${num(v.count)} times` : "Once"}</span>
          <span className={line}>{v.count > 1 ? "you watched your most replayed video:" : "Nothing twice. Your top video:"}</span>
          <span className="mt-auto flex min-h-0 items-center gap-3">
            {thumb && <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
                           className="aspect-video h-[clamp(36px,7.5vh,72px)] shrink-0 rounded-md border-2 object-cover" style={{ borderColor: OV.ink }} />}
            <span className="line-clamp-3 text-[clamp(12px,1.7vh,14px)] font-bold leading-snug" title={v.title ?? undefined}>{v.title}</span>
          </span>
        </>
      )}
    </SmallCard>
  );
}

function YearsStrip({ months, current }: { months?: MonthPoint[]; current: number | null }) {
  const years = months ? yearlyHours(months) : null;
  const best = years?.reduce((a, b) => (b.hours > a.hours ? b : a), years[0]);
  const total = years?.reduce((s, y) => s + y.hours, 0) ?? 0;
  const max = best?.hours || 1;
  const thisYear = Number(useMeta().data?.today.slice(0, 4));
  return (
    <Card className="flex-col gap-3 p-4 sm:flex-row sm:items-end sm:gap-8 sm:px-6 [@media(min-height:760px)]:py-5">
      <div className="flex shrink-0 flex-col gap-1 sm:w-[clamp(280px,34%,460px)]">
        <span className={kicker} style={{ color: OV.soft }}>Over the years</span>
        {years && best ? (
          <>
            <h2 className="font-ov-display text-[clamp(18px,2.8vh,26px)] font-extrabold leading-tight">{best.year} was your biggest year: {num(best.hours)} hours.</h2>
            <p className="text-[14px]" style={{ color: OV.soft }}>{num(total)} hours in all. * {thisYear} isn't over yet. Pick a year to open its Wrapped.</p>
          </>
        ) : <Skeleton />}
      </div>
      {years && (
        <div className="grid flex-1 items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${years.length},minmax(0,1fr))` }}>
          {years.map((y) => (
            <Link key={y.year} to={`/wrapped?year=${y.year}`}
                  aria-label={`${y.year}: ${num(y.hours)} hours${y.year === thisYear ? " so far" : ""}. Open its Wrapped`}
                  className="group flex flex-col items-stretch gap-0.5">
              <span className="flex h-[clamp(40px,8.5vh,120px)] flex-col justify-end">
                <span className="text-center font-shelf-mono text-[11px]">{num(y.hours)}</span>
                <span className={`block w-full rounded-t-md border-2 group-hover:brightness-95 ${y.year === thisYear ? "border-dashed" : ""}`}
                      style={{ height: `${Math.max(6, (y.hours / max) * 72)}%`, borderColor: OV.ink,
                               background: y.year === best?.year ? OV.accent : y.year === current ? OV.mustard : OV.sand }} />
              </span>
              <span className="text-center font-shelf-mono text-[12px]">’{String(y.year).slice(2)}{y.year === thisYear ? "*" : ""}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
