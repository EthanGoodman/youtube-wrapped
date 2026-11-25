/* The home page for platforms with shows (Netflix), in the shared look. Same shape as YouTube's: a hero with the hours
   and your #1, the top-10 row, then the must-haves from the priority table (how far you got, patterns, records), then
   a short strip of nice-to-haves (evolution, genres, movies). Posters instead of round faces. */
import { ReactNode } from "react";
import { Link, useCapability } from "../platform";
import { HourPoint, MonthPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { compact, date, num } from "../format";
import { Binge, EpisodeDay, KindSplit, ShowProgress, ShowStatus } from "../families/shows/data";
import type { HomeItem } from "../families/shows/Home";
import { Band, MoveBadge, OV, Poster, Skeleton, StatsFrame, kicker, useAccent, usePrevRanks } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { YearTop } from "./ReignTimeline";
import {
  Comparison, DAYS, Move, changeLine, clockFacts, hourLabel, hoursShort, longestReign, periodTitle, rankMove, spanLabel,
  topHeadline, weekdayFacts,
} from "./takeaways";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const eps = (n: number) => `${num(n)} episode${n === 1 ? "" : "s"}`;

/** Finished / still watching / dropped: the same three colors everywhere. */
export const STATUS: Record<ShowStatus, { label: string; bg: string; fg: string; bar: string }> = {
  finished: { label: "Finished", bg: OV.teal, fg: OV.paper, bar: OV.teal },
  watching: { label: "Still watching", bg: OV.mustard, fg: OV.ink, bar: OV.mustard },
  dropped: { label: "Dropped", bg: OV.sand, fg: OV.ink, bar: "#A99C86" },
};

interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null } }

export function ShowsOverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const today = meta.data?.today;
  const byTime = { ...filters, metric: "time" as const };
  const ov = useStats<Overview>("overview");
  const shows = useStats<TopResponse>("top/channels", { limit: 10 }, { filters: byTime });
  const home = useStats<{ data: { billboard: HomeItem | null } }>("shows/home", {}, { filters: byTime });
  const { cmp, prevRank } = usePrevRanks("channels", byTime);
  const sameSpan = cmp?.start ? { ...filters, range: "custom", start: cmp.start, end: cmp.end } : null;
  const lastOv = useStats<Overview>("overview", {}, { filters: sameSpan ?? filters, enabled: !!sameSpan });
  const prevHours = sameSpan ? lastOv.data?.est_s : ov.data?.previous.est_s;
  const top = shows.data?.items[0];
  const bill = home.data?.data.billboard;

  return (
    <StatsFrame>
      <Hero o={ov.data} top={top} topLoading={!shows.data} prev={prevHours} cmp={cmp} title={periodTitle(filters, today)}
            topMove={top ? rankMove(1, prevRank(top)) : null} backdrop={bill && bill.key === top?.key ? bill.backdrop : null} />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        <TopRow items={shows.data?.items} prevRank={prevRank} cmp={cmp} />
        <HowFar />
        <Patterns />
        <Records />
        <More />
      </main>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ o, top, topLoading, prev, cmp, title, topMove, backdrop }: {
  o?: Overview; top?: RankedItem; topLoading: boolean; prev?: number | null; cmp: Comparison | null; title: string;
  topMove: Move | null; backdrop?: string | null;
}) {
  const q = useLinkQuery();
  const meta = useMeta().data;
  const accent = useAccent();
  const split = useStats<{ data: KindSplit }>("shows/split").data?.data;
  const hours = o ? Math.round(o.est_s / 3600) : null;
  const change = o && cmp ? changeLine(o.est_s, prev, cmp.label) : null;
  const total = split ? split.episode.est_s + split.movie.est_s : 0;
  const showShare = total ? split!.episode.est_s / total : 0;
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      {/* warm two-tone backdrop: a still from your #1 show, in the platform's color and ink */}
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 30%, ${accent} 140%)` }}>
        {backdrop && <img key={backdrop} src={backdrop} alt="" referrerPolicy="no-referrer" className="absolute inset-y-0 right-0 h-full w-full object-cover lg:w-[70%]"
                          style={{ filter: "grayscale(1) contrast(1.15)", mixBlendMode: "multiply", opacity: 0.9 }} />}
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${OV.ink} 0%, ${OV.ink}ee 38%, ${OV.ink}55 70%, ${OV.ink}22 100%)` }} />
      <div className="relative mx-auto flex min-h-[clamp(420px,62vh,640px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[640px] flex-col gap-5">
          <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "Netflix"} · {title}</span>
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
                <Stat v={compact(o.videos)} l="titles" />
                <Stat v={compact(o.unique_channels)} l="shows" />
                <Stat v={num(o.active_days)} l={`of ${num(o.days)} days`} />
                <Stat v={`${Math.round(o.pct_days_active * 100)}%`} l="of days watched" />
              </dl>
              {split && showShare > 0 && showShare < 1 && (
                <div className="flex max-w-[520px] flex-col gap-1.5" role="img"
                     aria-label={`${Math.round(showShare * 100)}% shows, ${Math.round((1 - showShare) * 100)}% movies`}>
                  <span className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "#4A433B" }}>
                    <span style={{ width: `${showShare * 100}%`, background: OV.mustard }} />
                    <span style={{ width: `${(1 - showShare) * 100}%`, background: OV.paper }} />
                  </span>
                  <span className="flex justify-between font-shelf-mono text-[12px]" style={{ color: OV.mute }}>
                    <span><span style={{ color: OV.mustard }}>■</span> {Math.round(showShare * 100)}% shows · {eps(split.episode.count)}</span>
                    <span><span style={{ color: OV.paper }}>■</span> {Math.round((1 - showShare) * 100)}% movies · {num(split.movie.count)}</span>
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
                <Poster src={top.avatar_url} name={top.title} width="clamp(96px,11vw,170px)" ring={OV.paper} />
                <span className="absolute -right-4 -top-3 flex h-14 w-14 rotate-6 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                      style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }} aria-hidden>#1</span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className={kicker} style={{ color: OV.mustard }}>Your #1 show</span>
                <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">
                  {topHeadline(top.title, topMove?.tone === "same" ? 1 : undefined)}
                </span>
                <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{hoursShort(top.time_s)} · {eps(top.count)}</span>
              </span>
            </Link>
          ) : topLoading ? <Skeleton h={200} dark /> : null}
        </div>
      </div>
    </section>
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

// ------------------------------------------------------------------ top 10

function TopRow({ items, prevRank, cmp }: {
  items?: RankedItem[]; prevRank: (c: RankedItem) => number | null | undefined; cmp: Comparison | null;
}) {
  const q = useLinkQuery();
  return (
    <Band label={`By hours watched${cmp ? ` · arrows since ${cmp.label}` : ""}`} title="Your top 10 shows" link={["/top/channels", "All your shows"]}>
      {!items ? <Skeleton h={300} /> : !items.length ? <p style={{ color: OV.soft }}>No shows in this period.</p> : (
        <ol key={q} className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 pt-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-10 lg:overflow-visible">
          {items.map((c) => (
            <li key={c.key} className="w-[130px] shrink-0 snap-start lg:w-auto lg:min-w-0">
              <Link to={`/channel/${encodeURIComponent(c.key)}${q}`} className="group flex flex-col items-start gap-2">
                <span className="relative w-full">
                  <Poster src={c.avatar_url} name={c.title} width="100%" className="transition-transform duration-150 group-hover:-translate-y-0.5" />
                  <span className="absolute -left-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                        style={{ background: c.rank === 1 ? OV.mustard : OV.paper, borderColor: OV.ink }} aria-hidden>{c.rank}</span>
                </span>
                <span className="w-full truncate text-[15px] font-bold group-hover:underline">{c.title}</span>
                <span className="flex flex-col"><span className="font-ov-display text-[17px] font-extrabold leading-tight">{hoursShort(c.time_s)}</span>
                  <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{eps(c.count)}</span></span>
                <MoveBadge m={rankMove(c.rank, prevRank(c))} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Band>
  );
}

// ------------------------------------------------------------------ how far you got

export function howFarTitle(s: Record<ShowStatus, number>): string {
  const left = s.dropped;
  if (!s.finished && !left) return s.watching ? `${num(s.watching)} still going.` : "How far you got";
  if (!left) return `${num(s.finished)} finished, none left behind.`;
  return `${num(s.finished)} finished, ${num(left)} left behind.`;
}

export function StatusPill({ status }: { status: ShowStatus }) {
  const c = STATUS[status];
  return <span className="w-fit shrink-0 whitespace-nowrap rounded-full px-2 py-px font-shelf-mono text-[11px]" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
}

/** One show: poster, title, status, a bar for how much of it you watched, and the episode count. */
export function ProgressRow({ s, rank }: { s: ShowProgress; rank?: number }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/channel/${encodeURIComponent(s.key)}${q}`} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        {rank != null && <span className="w-6 shrink-0 text-right font-ov-display text-[15px] font-extrabold">{rank}</span>}
        <Poster src={s.avatar_url} name={s.title} width="44px" className="!border-2 !rounded-md" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[15px] font-bold">{s.title}</span>
            <StatusPill status={s.status} />
          </span>
          <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: OV.sand }}
                role="img" aria-label={s.pct != null ? `${Math.round(s.pct * 100)}% watched` : "How much is unknown"}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (s.pct ?? 0) * 100)}%`, background: STATUS[s.status].bar }} />
          </span>
          <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
            {s.total != null ? `${num(s.watched)} of ${num(s.total)} episodes` : eps(s.watched)}
            {s.seasons_total ? ` · ${num(s.seasons_finished ?? 0)} of ${num(s.seasons_total)} seasons` : ""}
            {s.pct != null ? ` · ${Math.round(s.pct * 100)}%` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

function HowFar() {
  const q = useLinkQuery();
  const prog = useStats<{ data: { summary: Record<ShowStatus, number>; shows: ShowProgress[] } }>("shows/progress", { limit: 6 });
  const d = prog.data?.data;
  return (
    <Band label="How far you got · each show you watched" title={d ? howFarTitle(d.summary) : "How far you got"} link={["/shows", "Every show"]}>
      {!d ? <Skeleton h={300} /> : !d.shows.length ? <p style={{ color: OV.soft }}>No shows in this period.</p> : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1">
            {(["finished", "watching", "dropped"] as const).map((k) => (
              <Link key={k} to={`/shows${q ? `${q}&` : "?"}status=${k}`} className="flex min-w-0 flex-col justify-center gap-1 rounded-2xl border-2 px-3 py-3 transition-transform sm:px-4 hover:-translate-y-0.5"
                    style={{ background: STATUS[k].bg, color: STATUS[k].fg, borderColor: OV.ink }}>
                <span className="font-ov-display text-[clamp(30px,3.4vw,44px)] font-extrabold leading-none">{num(d.summary[k])}</span>
                <span className="text-[13px] font-bold leading-tight sm:text-[14px]">{STATUS[k].label}</span>
                <span className="hidden text-[12px] opacity-80 sm:block">
                  {k === "finished" ? "watched to the latest episode" : k === "watching" ? "watched in the last 30 days" : "unfinished, 30+ days ago"}
                </span>
              </Link>
            ))}
          </div>
          <div className="min-w-0 rounded-2xl border-2 px-4 py-2 sm:px-5" style={{ background: OV.paper, borderColor: OV.ink }}>
            <ol className="flex flex-col">{d.shows.map((s) => <ProgressRow key={s.key} s={s} />)}</ol>
          </div>
        </div>
      )}
    </Band>
  );
}

// ------------------------------------------------------------------ patterns

function Patterns() {
  const hasTimes = useCapability("time_of_day");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly", {}, { enabled: !hasTimes });
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock", {}, { enabled: hasTimes });
  const heat = useStats<{ data: { count: number[][] } }>("patterns/heatmap");
  const w = heat.data ? weekdayFacts(heat.data.data.count) : null;
  const wmax = w ? Math.max(1, ...w.totals) : 1;
  return (
    <Band label="Patterns · when you watch" title={w ? `Mostly on ${w.busiest}s.` : "When you watch"}
          link={["/patterns", "All your patterns"]}>
      {!heat.data ? <Skeleton h={240} /> : !w ? <p style={{ color: OV.soft }}>Nothing watched in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {hasTimes ? <ClockCard data={clock.data?.data} /> : <MonthCard data={monthly.data?.data} />}
          <figure className="flex flex-col gap-3 rounded-2xl border-2 p-5" style={{ background: OV.paper, borderColor: OV.ink }}>
            <figcaption>
              <span className="font-ov-display text-[28px] font-extrabold">{w.busiest}</span>
              <span className="ml-2 text-[15px]">is your busiest day</span>
            </figcaption>
            <HoverBars height={120} gap={8} radius={6} hint="Hover a day to see it." ariaLabel={`Titles by day of the week. Busiest: ${w.busiest}.`}
                       bars={w.totals.map((t, i) => ({ key: DAYS[i], label: WEEKDAYS[i], value: t, display: `${num(t)} titles`, color: t === wmax ? OV.teal : "#D9CDB6" }))}
                       ticks={<Ticks labels={DAYS} />} />
          </figure>
        </div>
      )}
    </Band>
  );
}

function MonthCard({ data }: { data?: MonthPoint[] }) {
  if (!data) return <Skeleton h={240} dark />;
  if (!data.length) return <div />;
  const best = data.reduce((a, b) => (b.time_s > a.time_s ? b : a));
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const many = data.length > 24;
  return (
    <figure className="flex flex-col gap-3 rounded-2xl p-5" style={{ background: OV.ink, color: OV.paper }}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span><span className="font-ov-display text-[28px] font-extrabold" style={{ color: OV.mustard }}>{label(best.month)}</span>
          <span className="ml-2 text-[15px]">was your biggest month</span></span>
        <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{hoursShort(best.time_s)} · {num(best.count)} titles</span>
      </figcaption>
      <HoverBars dark height={150} hint="Hover a month to see it." ariaLabel={`Hours per month. Biggest: ${label(best.month)}.`}
                 bars={data.map((x) => ({ key: x.month, label: label(x.month), value: x.time_s, display: `${hoursShort(x.time_s)} · ${num(x.count)} titles`,
                                          color: x.month === best.month ? OV.mustard : "#5E554A" }))}
                 ticks={<Ticks dark labels={data.map((x) => (many ? (x.month.endsWith("-01") ? x.month.slice(0, 4) : "")
                                                               : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })))} />} />
    </figure>
  );
}

function ClockCard({ data }: { data?: HourPoint[] }) {
  if (!data) return <Skeleton h={240} dark />;
  const f = clockFacts(data);
  if (!f) return <div />;
  return (
    <figure className="flex flex-col gap-3 rounded-2xl p-5" style={{ background: OV.ink, color: OV.paper }}>
      <figcaption>
        <span className="font-ov-display text-[28px] font-extrabold" style={{ color: OV.mustard }}>{hourLabel(f.peak)}</span>
        <span className="ml-2 text-[15px]">is your busiest hour</span>
      </figcaption>
      <HoverBars dark height={150} hint="Hover an hour to see it." ariaLabel={`Titles started by hour. Busiest: ${hourLabel(f.peak)}.`}
                 bars={data.map((h) => ({ key: String(h.hour), label: `${hourLabel(h.hour)} to ${hourLabel((h.hour + 1) % 24)}`, value: h.count,
                                          display: `${num(h.count)} titles`, color: h.hour === f.peak ? OV.mustard : h.hour < 5 ? "#8E8170" : "#5E554A" }))}
                 ticks={<Ticks dark labels={["12 AM", "6 AM", "12 PM", "6 PM"]} />} />
    </figure>
  );
}

// ------------------------------------------------------------------ records

function Records() {
  const q = useLinkQuery();
  const binge = useStats<{ data: Binge[] }>("shows/binges", { limit: 1 });
  const day = useStats<{ data: EpisodeDay[] }>("shows/days", { limit: 1 });
  const rec = useStats<RecordsResponse>("records");
  const b = binge.data?.data[0];
  const e = day.data?.data[0];
  const s = rec.data?.streaks.longest;
  return (
    <Band label="Records · your personal bests" title={b ? `A whole season in ${b.days === 1 ? "one day" : `${num(b.days)} days`}.` : "Your records"}
          link={["/records", "All your records"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <RecordCard label="Fastest season" bg={OV.mustard} loading={!binge.data} to={b && `/channel/${encodeURIComponent(b.key)}${q}`}
                    poster={b?.avatar_url} name={b?.title}
                    big={b ? (b.days === 1 ? "1 day" : `${num(b.days)} days`) : "–"}
                    line={b ? <><strong>{b.title}</strong>, season {b.season}: {eps(b.episodes)}</> : "No whole season finished in this period."} />
        <RecordCard label="One show, one day" bg={OV.paper} loading={!day.data} to={e && `/channel/${encodeURIComponent(e.key)}${q}`}
                    poster={e?.avatar_url} name={e?.title}
                    big={e ? eps(e.episodes) : "–"}
                    line={e ? <><strong>{e.title}</strong> on {date(e.date)}</> : "Nothing in this period."} />
        <RecordCard label="Longest streak" bg={OV.teal} fg={OV.paper} loading={!rec.data} to={`/records${q}`}
                    big={s ? `${num(s.days)} days in a row` : "–"}
                    line={s ? `${spanLabel(s.start, s.end)}, something every day` : "Not enough data yet."} />
      </div>
    </Band>
  );
}

function RecordCard({ label, big, line, bg, fg = OV.ink, poster, name, to, loading }: {
  label: string; big: string; line: ReactNode; bg: string; fg?: string; poster?: string | null; name?: string | null; to?: string; loading: boolean;
}) {
  const body = (
    <>
      <span className={kicker}>{label}</span>
      {loading ? <Skeleton h={80} /> : (
        <span className="flex items-center gap-4">
          {(poster || name) && <Poster src={poster} name={name} width="64px" />}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-ov-display text-[clamp(26px,2.6vw,34px)] font-extrabold leading-tight">{big}</span>
            <span className="text-[14px]">{line}</span>
          </span>
        </span>
      )}
    </>
  );
  const cls = "flex flex-col gap-3 rounded-2xl border-2 p-5";
  const style = { background: bg, color: fg, borderColor: OV.ink };
  return to ? <Link to={to} className={`${cls} transition-transform hover:-translate-y-0.5`} style={style}>{body}</Link>
            : <div className={cls} style={style}>{body}</div>;
}

// ------------------------------------------------------------------ more to explore

function More() {
  const { filters } = useFilters();
  const genre = useStats<TopResponse>("top/genres", { limit: 1 });
  const movies = useStats<{ items: (RankedItem & { poster?: string | null })[] }>("top/movies", { limit: 1 }, { filters: { ...filters, metric: "time" } });
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: { ...filters, range: "all", metric: "time" } });
  const g = genre.data?.items[0];
  const m = movies.data?.items[0];
  const reign = tops.data ? longestReign(tops.data) : null;
  return (
    <Band label="More to explore" title="A few more things">
      <div className="grid gap-4 sm:grid-cols-3">
        <MoreCard to="/evolution" label="Evolution" bg={OV.paper}>
          {!tops.data ? <Skeleton h={68} /> : reign && reign.years > 1 ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{reign.title}</span>
              <span className="text-[14px]">your #1 show {num(reign.years)} years running. See how your taste changed.</span>
            </span>
          ) : tops.data.length > 1 ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{num(tops.data.length)} different #1s</span>
              <span className="text-[14px]">From {tops.data[0].title} in {tops.data[0].year} to {tops.data[tops.data.length - 1].title} in {tops.data[tops.data.length - 1].year}.</span>
            </span>
          ) : <span className="text-[14px]">See how your taste changed.</span>}
        </MoreCard>
        <MoreCard to="/top/genres" label="Top genres" bg={OV.mustard}>
          {g ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{g.title}</span>
              <span className="text-[14px]">in {Math.round(g.share * 100)}% of what you watched</span>
            </span>
          ) : genre.data ? <span className="text-[14px]">No genres in this period.</span> : <Skeleton h={68} />}
        </MoreCard>
        <MoreCard to="/top/movies" label="Top movies" bg={OV.teal} fg={OV.paper}>
          {m ? (
            <span className="flex items-center gap-3">
              <Poster src={m.poster ?? m.thumb} name={m.title} width="52px" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 font-ov-display text-[20px] font-extrabold leading-tight">{m.title}</span>
                <span className="text-[14px]">your most watched movie{m.count > 1 ? `, ${num(m.count)} times` : ""}</span>
              </span>
            </span>
          ) : movies.data ? <span className="text-[14px]">No movies in this period.</span> : <Skeleton h={68} />}
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
