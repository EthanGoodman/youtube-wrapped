/* The home page for game platforms (Steam first), in the shared look. From the priority table: hours played and your top
   games up top; then the must-haves (patterns, records, evolution) and Steam's own story, achievements; genres as a link.
   Hours before the app's first daily snapshot are estimates (spread over achievement days); the hero says so. */
import { ReactNode } from "react";
import { Link, useCapability } from "../platform";
import { MonthPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num } from "../format";
import { Band, MoveBadge, OV, Poster, ScrollRow, Skeleton, StatsFrame, kicker, useAccent, usePrevRanks } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { ReignTimeline, YearTop, reignTitle } from "./ReignTimeline";
import {
  Comparison, DAYS, Move, changeLine, hoursShort, periodTitle, rankMove, spanLabel, topHeadline, weekdayFacts, yearsToShow,
} from "./takeaways";

export interface GameCard { key: string; title: string | null; poster: string | null; header: string | null }
export interface Unlock { game: GameCard; api: string; name: string; description: string | null; unlocked: string; rarity: number | null }
export interface Achievements {
  unlocked: number; total: number; per_month: { month: string; count: number }[];
  best_day: { date: string; game: GameCard; count: number } | null;
  rarest: Unlock[]; recent: Unlock[]; perfect: { game: GameCard; achievements: number; completed: string }[];
}
interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null }; biggest_day: { by_time: { date: string; time_s: number } | null } }

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const gameLink = (k: string) => `/channel/${encodeURIComponent(k)}`;
export const rarityLine = (r: number | null) => (r == null ? "" : r < 1 ? "under 1% of players have it" : `${r < 10 ? r.toFixed(1) : Math.round(r)}% of players have it`);

export function GamesOverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const byTime = { ...filters, metric: "time" as const };
  const ov = useStats<Overview>("overview");
  const games = useStats<TopResponse>("top/channels", { limit: 10 }, { filters: byTime });
  const ach = useStats<Achievements>("games/achievements");
  const { cmp, prevRank } = usePrevRanks("channels", byTime);
  const top = games.data?.items[0];
  return (
    <StatsFrame>
      <Hero o={ov.data} top={top} topLoading={!games.data} cmp={cmp} title={periodTitle(filters, meta.data?.today)}
            topMove={top ? rankMove(1, prevRank(top)) : null} achievements={ach.data?.unlocked} />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        <TopRow items={games.data?.items} prevRank={prevRank} cmp={cmp} />
        <AchievementsBand a={ach.data} />
        <Patterns />
        <Evolution />
        <Records a={ach.data} />
        <More />
      </main>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ o, top, topLoading, cmp, title, topMove, achievements }: {
  o?: Overview; top?: RankedItem; topLoading: boolean; cmp: Comparison | null; title: string; topMove: Move | null; achievements?: number;
}) {
  const q = useLinkQuery();
  const meta = useMeta().data;
  const accent = useAccent();
  const hours = o ? Math.round(o.est_s / 3600) : null;
  const change = o && cmp ? changeLine(o.est_s, o.previous.est_s, cmp.label) : null;
  const since = meta?.tracked_since;
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 35%, ${accent} 150%)` }} />
      <div className="relative mx-auto flex min-h-[clamp(400px,58vh,600px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[640px] flex-col gap-5">
          <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "games"} · {title}</span>
          {o && hours != null ? (
            <>
              <h1 className="flex items-baseline gap-4 font-ov-display font-extrabold leading-[0.82]">
                <span className="text-[clamp(96px,13vw,190px)] tracking-[-0.05em]" style={{ color: OV.mustard }}>{num(hours)}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-[clamp(26px,2.6vw,38px)]">hours</span>
                  <span className="font-shelf-mono text-[12px] font-normal" style={{ color: OV.mute }}>played</span>
                </span>
              </h1>
              {change && <p className="text-[18px]">{change}</p>}
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Stat v={num(o.unique_channels)} l="games played" />
                <Stat v={num(o.active_days)} l={`of ${num(o.days)} days`} />
                <Stat v={achievements != null ? num(achievements) : "–"} l="achievements" />
                <Stat v={`${Math.round(o.pct_days_active * 100)}%`} l="of days played" />
              </dl>
              {since && <p className="max-w-[520px] font-shelf-mono text-[12px]" style={{ color: OV.mute }}>
                Exact from {date(since)}, when the app started its daily check. Hours before that are estimated from the days you earned achievements.
              </p>}
            </>
          ) : <Skeleton h={240} dark />}
        </div>
        <div className="shrink-0 lg:w-[300px]">
          {top ? (
            <Link to={gameLink(top.key) + q} className="group flex items-center gap-5 lg:flex-col lg:items-start">
              <span className="relative">
                <Poster src={top.avatar_url} name={top.title} width="clamp(110px,12vw,180px)" ring={OV.paper} />
                <span className="absolute -right-4 -top-3 flex h-14 w-14 rotate-6 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                      style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }} aria-hidden>#1</span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className={kicker} style={{ color: OV.mustard }}>Your #1 game</span>
                <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">
                  {topHeadline(top.title, topMove?.tone === "same" ? 1 : undefined)}
                </span>
                <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{hoursShort(top.time_s)} · {num(top.count)} day{top.count === 1 ? "" : "s"} played</span>
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

// ------------------------------------------------------------------ top games, achievements

function TopRow({ items, prevRank, cmp }: { items?: RankedItem[]; prevRank: (c: RankedItem) => number | null | undefined; cmp: Comparison | null }) {
  const q = useLinkQuery();
  return (
    <Band label={`By hours played${cmp ? ` · arrows since ${cmp.label}` : ""}`} title="Your top 10 games" link={["/top/channels", "All your games"]}>
      {!items ? <Skeleton h={300} /> : !items.length ? <p style={{ color: OV.soft }}>No games in this period.</p> : (
        <ScrollRow key={q} outer="-mx-4 sm:mx-0" className="snap-x px-4 sm:px-0 lg:overflow-visible">
          <ol className="flex gap-4 pb-2 pt-2 lg:grid lg:grid-cols-10">
            {items.map((c) => (
              <li key={c.key} className="w-[130px] shrink-0 snap-start lg:w-auto lg:min-w-0">
                <Link to={gameLink(c.key) + q} className="group flex flex-col items-start gap-2">
                  <span className="relative w-full">
                    <Poster src={c.avatar_url} name={c.title} width="100%" className="transition-transform duration-150 group-hover:-translate-y-0.5" />
                    <span className="absolute -left-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                          style={{ background: c.rank === 1 ? OV.mustard : OV.paper, borderColor: OV.ink }} aria-hidden>{c.rank}</span>
                  </span>
                  <span className="w-full truncate text-[15px] font-bold group-hover:underline">{c.title}</span>
                  <span className="font-ov-display text-[17px] font-extrabold leading-tight">{hoursShort(c.time_s)}</span>
                  <MoveBadge m={rankMove(c.rank, prevRank(c))} />
                </Link>
              </li>
            ))}
          </ol>
        </ScrollRow>
      )}
    </Band>
  );
}

export function UnlockRow({ u }: { u: Unlock }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={gameLink(u.game.key) + q} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        <Poster src={u.game.poster} name={u.game.title} width="38px" className="!rounded-md !border-2" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold">{u.name}</span>
          <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{u.game.title} · {date(u.unlocked)}</span>
        </span>
        {u.rarity != null && (
          <span className="shrink-0 rounded-full border-2 px-2.5 py-0.5 font-ov-display text-[13px] font-extrabold"
                style={{ borderColor: OV.ink, background: u.rarity < 10 ? OV.mustard : OV.paper }}>{u.rarity < 1 ? "<1" : Math.round(u.rarity)}%</span>
        )}
      </Link>
    </li>
  );
}

function AchievementsBand({ a }: { a?: Achievements }) {
  if (!useCapability("achievements")) return null;
  const rare = a?.rarest[0];
  return (
    <Band label="Achievements · dated proof of when you played" title={a ? (rare ? `${rare.name}: ${rarityLine(rare.rarity)}.` : `${num(a.unlocked)} achievements.`) : "Achievements"}
          link={["/achievements", "All your achievements"]}>
      {!a ? <Skeleton h={240} /> : !a.unlocked ? <p style={{ color: OV.soft }}>No achievements unlocked in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card label="Rarest you unlocked"><ol className="flex flex-col">{a.rarest.slice(0, 4).map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol></Card>
          <Card label="Most recent"><ol className="flex flex-col">{a.recent.slice(0, 4).map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol></Card>
        </div>
      )}
    </Band>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 px-5 py-4" style={{ background: OV.paper, borderColor: OV.ink }}>
      <span className={kicker} style={{ color: OV.soft }}>{label}</span>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ patterns, evolution, records, more

function Patterns() {
  const heat = useStats<{ data: { time_s: number[][] } }>("patterns/heatmap");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const w = heat.data ? weekdayFacts(heat.data.data.time_s) : null;
  const wmax = w ? Math.max(1, ...w.totals) : 1;
  const months = monthly.data?.data ?? [];
  const best = months.length ? months.reduce((a, b) => (b.time_s > a.time_s ? b : a)) : null;
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const many = months.length > 24;
  return (
    <Band label="Patterns · when you play" title={w ? `Mostly on ${w.busiest}s.` : "When you play"} link={["/patterns", "All your patterns"]}>
      {!heat.data || !monthly.data ? <Skeleton h={240} /> : !w ? <p style={{ color: OV.soft }}>Nothing played in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <figure className="flex flex-col gap-3 rounded-2xl p-5" style={{ background: OV.ink, color: OV.paper }}>
            <figcaption><span className="font-ov-display text-[28px] font-extrabold" style={{ color: OV.mustard }}>{best ? label(best.month) : "–"}</span>
              <span className="ml-2 text-[15px]">was your biggest month</span></figcaption>
            <HoverBars dark height={150} hint="Hover a month to see it." ariaLabel="Hours played per month"
                       bars={months.map((x) => ({ key: x.month, label: label(x.month), value: x.time_s, display: hoursShort(x.time_s),
                                                  color: x.month === best?.month ? OV.mustard : "#5E554A" }))}
                       ticks={<Ticks dark labels={months.map((x) => (x.month.endsWith("-01") ? x.month.slice(0, 4) : many ? "" : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })))} />} />
          </figure>
          <figure className="flex flex-col gap-3 rounded-2xl border-2 p-5" style={{ background: OV.paper, borderColor: OV.ink }}>
            <figcaption><span className="font-ov-display text-[28px] font-extrabold">{w.busiest}</span><span className="ml-2 text-[15px]">is your busiest day</span></figcaption>
            <HoverBars height={120} gap={8} radius={6} hint="Hover a day to see it." ariaLabel={`Hours by day of the week. Busiest: ${w.busiest}.`}
                       bars={w.totals.map((t, i) => ({ key: DAYS[i], label: WEEKDAYS[i], value: t, display: hoursShort(t), color: t === wmax ? OV.teal : "#D9CDB6" }))}
                       ticks={<Ticks labels={DAYS} />} />
          </figure>
        </div>
      )}
    </Band>
  );
}

function Evolution() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const years = yearsToShow(filters, meta?.first_date, meta?.today);
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: { ...filters, range: "all", metric: "time" }, enabled: !!years });
  if (!years) return null;
  const rows = tops.data?.filter((t) => years.includes(t.year));
  return (
    <Band label="Your #1 game each year" title={rows ? reignTitle(rows) : "Your #1 each year"} link={["/evolution", "See how it changed"]}>
      {!rows ? <Skeleton h={160} /> : <ReignTimeline rows={rows} calendarYears={filters.range === "custom"} />}
    </Band>
  );
}

function Records({ a }: { a?: Achievements }) {
  const q = useLinkQuery();
  const rec = useStats<RecordsResponse>("records");
  const s = rec.data?.streaks.longest;
  const d = rec.data?.biggest_day.by_time;
  const p = a?.perfect[0];
  return (
    <Band label="Records · your personal bests" title={a?.perfect.length ? `${num(a.perfect.length)} game${a.perfect.length === 1 ? "" : "s"} at 100%.` : "Your records"}
          link={["/records", "All your records"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <RecordCard label="100% completed" bg={OV.mustard} loading={!a} to={p ? gameLink(p.game.key) + q : undefined}
                    pic={p ? <Poster src={p.game.poster} name={p.game.title} width="56px" /> : undefined}
                    big={p ? (p.game.title ?? "–") : "None yet"} line={p ? `all ${num(p.achievements)} achievements, ${date(p.completed)}` : "No game with every achievement in this period."} />
        <RecordCard label="Longest streak" bg={OV.teal} fg={OV.paper} loading={!rec.data} to={`/records${q}`}
                    big={s ? `${num(s.days)} day${s.days === 1 ? "" : "s"} in a row` : "–"} line={s ? `${spanLabel(s.start, s.end)}, something every day` : "Not enough data yet."} />
        <RecordCard label="Biggest day" bg={OV.paper} loading={!rec.data} to={`/records${q}`}
                    big={d ? hoursShort(d.time_s) : "–"} line={d ? `on ${date(d.date)}` : "Nothing in this period."} />
      </div>
    </Band>
  );
}

function RecordCard({ label, big, line, bg, fg = OV.ink, pic, to, loading }: {
  label: string; big: string; line: ReactNode; bg: string; fg?: string; pic?: ReactNode; to?: string; loading: boolean;
}) {
  const body = (
    <>
      <span className={kicker}>{label}</span>
      {loading ? <Skeleton h={72} /> : (
        <span className="flex items-center gap-4">
          {pic}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-ov-display text-[clamp(22px,2.2vw,30px)] font-extrabold leading-tight">{big}</span>
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

function More() {
  const q = useLinkQuery();
  const genres = useCapability("genres");
  const g = useStats<TopResponse>("top/genres", { limit: 1 }, { enabled: genres });
  const card = "flex flex-col gap-3 rounded-2xl border-2 p-5 transition-transform hover:-translate-y-0.5";
  return (
    <Band label="More to explore" title="A few more things">
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to={`${genres ? "/top/genres" : "/evolution"}${q}`} className={card} style={{ background: OV.mustard, borderColor: OV.ink }}>
          <span className="flex justify-between"><span className={kicker}>{genres ? "Top genres" : "Evolution"}</span><span aria-hidden>›</span></span>
          {genres && g.data?.items[0] ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{g.data.items[0].title}</span>
              <span className="text-[14px]">in {Math.round(g.data.items[0].share * 100)}% of your playtime</span>
            </span>
          ) : <span className="text-[14px]">How your games changed over the years.</span>}
        </Link>
        <Link to={`/evolution${q}`} className={card} style={{ background: OV.paper, borderColor: OV.ink }}>
          <span className="flex justify-between"><span className={kicker}>Evolution</span><span aria-hidden>›</span></span>
          <span className="text-[14px]">Your #1 game each year, the bar race, and the games you kept coming back to.</span>
        </Link>
      </div>
    </Band>
  );
}
