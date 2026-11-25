/* The new home page (YouTube first). Shape for every platform: a hero with the hours and your #1, then the top-10
   row, then the must-have sections (here Evolution and Patterns), then a short strip of nice-to-haves. Our own look:
   ink hero with a warm two-tone backdrop, cream page, mustard / teal / red-orange accents; not the service's UI. */
import { ReactNode, useState } from "react";
import { Link } from "../platform";
import { HourPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { Band, MoveBadge, OV, Pic, Skeleton, StatsFrame, kicker, usePrevRanks } from "./kit";
import { compact, num } from "../format";
import {
  Comparison, DAYS, Move, changeLine, clockFacts, hourLabel, hoursShort, groupReigns, longestReign, oneIn, periodTitle, rankMove,
  monthDay, rankingFilters, spanLabel, topHeadline, weekdayFacts, yearsToShow,
} from "./takeaways";

interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null } }
interface YearTop { year: number; channel_id: string; title?: string | null; avatar_url?: string | null; time_s: number }
interface ChannelDetail { top_videos: RankedItem[] }

export function OverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const today = meta.data?.today;
  const ov = useStats<Overview>("overview");
  // like Wrapped: rank by what you sat down to watch (Shorts only when that's all you picked), and by hours
  const byTime = { ...rankingFilters(filters), metric: "time" as const };
  const channels = useStats<TopResponse>("top/channels", { limit: 10 }, { filters: byTime });
  // arrows compare with the same dates last year ("this year") or the API's previous period
  const { cmp, prevRank } = usePrevRanks("channels", byTime);
  const sameSpan = cmp?.start ? { ...filters, range: "custom", start: cmp.start, end: cmp.end } : null;
  const lastOv = useStats<Overview>("overview", {}, { filters: sameSpan ?? filters, enabled: !!sameSpan });
  const prevHours = sameSpan ? lastOv.data?.est_s : ov.data?.previous.est_s;
  const top = channels.data?.items[0];

  return (
    <StatsFrame>
      <Hero o={ov.data} top={top} topLoading={!channels.data} prev={prevHours} cmp={cmp}
            title={periodTitle(filters, today)} topMove={top ? rankMove(1, prevRank(top)) : null} />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        <TopRow items={channels.data?.items} prevRank={prevRank} cmp={cmp} />
        <Patterns />
        <Evolution />
        <More />
      </main>
    </StatsFrame>
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
  // your history may start mid-year: say so, or that year's small number looks odd
  const firstYear = Number(meta?.first_date?.slice(0, 4));
  const firstMd = meta?.first_date?.slice(5) ?? "01-01";
  const title = reign && reign.years >= 2 ? `${reign.title} was your #1 ${reign.years} years running.` : "A different #1 almost every year.";
  return (
    <Band label="Your #1 channel each year" title={title} link={["/evolution", "See how it changed"]}>
      {/* about the channels: each year's hours here are that channel's, never your total */}
      {!rows ? <Skeleton h={160} /> : (
        <>
          {/* a timeline of reigns: a run of years with the same #1 is one block, as wide as the run */}
          <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ol className="grid min-w-[560px] gap-3" style={{ gridTemplateColumns: `repeat(${rows.length},minmax(0,1fr))` }}>
              {groupReigns(rows).map((g) => {
                const star = reign != null && reign.years >= 2 && g.years.length === reign.years && g.first.title === reign.title;
                const live = g.to === thisYear;
                const partial = g.from === firstYear && firstMd !== "01-01";
                const span = g.from === g.to
                  ? `${g.from}${live ? " so far" : ""}`
                  : `${g.from}–${live ? "now" : g.to}`;
                const body = (
                  <>
                    <span className="flex flex-col font-shelf-mono text-[12px] font-medium">{span}{partial && <span className="text-[11px] font-normal" style={{ color: OV.soft }}>from {monthDay(meta?.first_date)}</span>}</span>
                    <Pic src={g.first.avatar_url} name={g.first.title} size={star ? "68px" : "48px"} />
                    <span className="w-full truncate text-[14px] font-bold">{g.first.title}</span>
                    <span className="font-ov-display text-[20px] font-extrabold leading-none">{hoursShort(g.total_s)}</span>
                    {g.years.length > 1 && (
                      <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                        {g.years.map((y) => (
                          <Link key={y.year} to={`/wrapped?year=${y.year}`}
                                className="rounded-full border px-2 py-0.5 font-shelf-mono text-[11px] hover:underline"
                                style={{ borderColor: OV.ink, background: star ? OV.paper : "transparent" }}
                                aria-label={`${y.year}: ${hoursShort(y.time_s)} of ${g.first.title ?? "this channel"}. Open ${y.year} Wrapped`}>
                            {y.year} · {hoursShort(y.time_s)}
                          </Link>
                        ))}
                      </span>
                    )}
                  </>
                );
                const cls = "flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center";
                const style = { gridColumn: `span ${g.years.length}`, background: star ? OV.mustard : OV.paper, borderColor: star ? OV.ink : "#D9CDB6" };
                return g.years.length === 1 ? (
                  <li key={g.from} className="min-w-0" style={{ gridColumn: style.gridColumn }}>
                    <Link to={`/wrapped?year=${g.from}`} className={`${cls} group hover:brightness-[0.98]`} style={style}
                          aria-label={`${g.from}: your #1 was ${g.first.title ?? "unknown"}, ${hoursShort(g.total_s)}. Open ${g.from} Wrapped`}>
                      {body}
                    </Link>
                  </li>
                ) : (
                  <li key={g.from} className={`min-w-0 ${cls}`} style={style}>{body}</li>
                );
              })}
            </ol>
          </div>
          <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
            Hours are what you watched of that channel{filters.range === "custom" ? " in those calendar years" : ""}. Pick a year to open its Wrapped.
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
