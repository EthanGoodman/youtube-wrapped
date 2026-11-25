/* Evolution in the new look: how your taste changed. Main: your #1 each year (reigns) and your total hours per year.
   Secondary: most loyal and fell off. Then new discoveries, the bar chart race and your mix by year. */
import { useEffect, useMemo, useState } from "react";
import { Link, useCapability } from "../platform";
import { MonthPoint, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num, pct } from "../format";
import { Avatar, OV, PageBody, PageHeader, Seg, Skeleton, StatsFrame, kicker, useCreator, useNoun, useVerb } from "./kit";
import { ReignTimeline, YearTop, reignTitle } from "./ReignTimeline";
import { Readout } from "./charts";
import { hoursShort, raceAt, raceColors, rankingFilters, yearlyHours } from "./takeaways";

interface Ref { channel_id: string; title?: string | null; avatar_url?: string | null }
type Discovery = Ref & { first_watched: string; count: number; time_s: number };
type Loyal = Ref & { years: number; count: number; year_list: number[] };
type FellOff = Ref & { count_before: number; count_recent: number; last_watched: string; peak_year: number };
interface Race { metric: "count" | "time"; frames: { month: string; top: { channel_id: string; value: number }[] }[]; channels: Record<string, { title: string; avatar_url: string | null }> }
interface Mix { years: number[]; series: Record<string, number[]> }

/** Categorical colors for the cream pages: our inks first, each distinct in lightness or hue. */
const MIX_COLORS = ["#1A1714", "#B83A24", "#E2A93B", "#2E6B63", "#6E4C7E", "#4C7DA8", "#8A8B3C", "#C98A5B"];
/** The race shows 10 bars at once, so it needs more than 8: the same warm family, plus rose, navy, sage and brown. */
const RACE_COLORS = [...MIX_COLORS, "#A34E6E", "#2F4A7A", "#7FA27A", "#8C6239"];
const OTHER = "#CDBFA6";

export function EvolutionPage() {
  const cr = useCreator();
  const { filters } = useFilters();
  const all = { ...rankingFilters(filters), range: "all", metric: "time" as const };
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: all });
  const months = useStats<{ data: MonthPoint[] }>("patterns/monthly", {}, { filters: { ...filters, range: "all" } });
  return (
    <StatsFrame>
      <PageHeader label="Evolution · all time" title={tops.data ? reignTitle(tops.data) : "How your taste changed"}>
        <p className="text-[17px]" style={{ color: OV.mute }}>How your favorites and your habits changed over the years.</p>
      </PageHeader>
      <PageBody>
        <section className="flex flex-col gap-4">
          <span className={kicker} style={{ color: OV.soft }}>Your #1 {cr.one} each year</span>
          {!tops.data ? <Skeleton h={180} /> : <ReignTimeline rows={tops.data} />}
        </section>
        <YearTotals months={months.data?.data} />
        <div className="grid gap-4 lg:grid-cols-2">
          <LoyalCard />
          <FellOffCard />
        </div>
        <Discoveries />
        <BarRace />
        <MixByYear />
      </PageBody>
    </StatsFrame>
  );
}

function Card({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6" style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        {title && <h2 className="font-ov-display text-[26px] font-extrabold leading-tight">{title}</h2>}
      </div>
      {children}
    </section>
  );
}

function YearTotals({ months }: { months?: MonthPoint[] }) {
  const cr = useCreator();
  const thisYear = Number(useMeta().data?.today.slice(0, 4));
  const [on, setOn] = useState<number | null>(null);
  if (!months) return <Skeleton h={220} />;
  const years = yearlyHours(months);
  if (!years.length) return null;
  const best = years.reduce((a, b) => (b.hours > a.hours ? b : a));
  return (
    <Card label="Your total hours each year" title={`${best.year} was your biggest year: ${num(best.hours)} hours`}>
      <Readout active={on != null}
               text={on != null ? `${on}${on === thisYear ? " so far" : ""} · ${num(years.find((y) => y.year === on)?.hours ?? 0)} hours · open its Wrapped` : "Hover a year to see it. Click one to open its Wrapped."} />
      <div className="grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${years.length},minmax(0,1fr))` }} onMouseLeave={() => setOn(null)}>
        {years.map((y) => (
          <Link key={y.year} to={`/wrapped?year=${y.year}`} className="group flex flex-col items-center gap-1 transition-opacity duration-150"
                style={{ opacity: on != null && on !== y.year ? 0.35 : 1 }}
                onMouseEnter={() => setOn(y.year)} onFocus={() => setOn(y.year)} onBlur={() => setOn(null)}
                aria-label={`${y.year}: ${num(y.hours)} hours in total${y.year === thisYear ? " so far" : ""}. Open its Wrapped`}>
            <span className="flex h-[150px] w-full flex-col justify-end">
              <span className="text-center font-shelf-mono text-[11px]" style={y.year === best.year ? { color: OV.accent, fontWeight: 700 } : undefined}>{num(y.hours)}</span>
              <span className={`block w-full rounded-t-md group-hover:brightness-95 ${y.year === thisYear ? "border-2 border-dashed" : "border-2"}`}
                    style={{ height: `${Math.max(3, (y.hours / best.hours) * 88)}%`, borderColor: OV.ink,
                             background: y.year === best.year ? OV.accent : y.year === thisYear ? OV.mustard : OV.sand }} />
            </span>
            <span className="font-shelf-mono text-[12px]">{y.year}{y.year === thisYear ? "*" : ""}</span>
          </Link>
        ))}
      </div>
      <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>All your {cr.many} together. * {thisYear} isn't over yet.</p>
    </Card>
  );
}

function LoyalCard() {
  const n = useNoun();
  const meta = useMeta().data;
  const q = useLinkQuery();
  const loyal = useStats<Loyal[]>("evolution/loyalty", { limit: 10 });
  const allYears = meta?.years ?? [];
  const top = loyal.data?.[0];
  return (
    <Card label={`Most loyal · 3+ ${n.many} a year`} title={top ? `${top.title}: ${top.years} different years` : "Most loyal"}>
      {!loyal.data ? <Skeleton h={300} /> : !loyal.data.length ? <p style={{ color: OV.soft }}>Not enough data yet.</p> : (
        <ol className="flex flex-col">
          {loyal.data.map((c, i) => (
            <li key={c.channel_id}>
              <Link to={`/channel/${encodeURIComponent(c.channel_id)}${q}`} className="flex items-center gap-3 border-b py-2 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
                <span className="w-5 text-right font-ov-display text-[15px] font-extrabold">{i + 1}</span>
                <Avatar src={c.avatar_url} name={c.title} size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[14px] font-bold">{c.title}</span>
                  <span className="flex gap-1" aria-label={`watched in ${c.year_list.join(", ")}`}>
                    {allYears.map((y) => <span key={y} title={String(y)} className="h-2 w-2 rounded-full" style={{ background: c.year_list.includes(y) ? OV.teal : "#DCD0B9" }} />)}
                  </span>
                </span>
                <span className="text-right font-ov-display text-[15px] font-extrabold">{c.years} yrs</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function FellOffCard() {
  const q = useLinkQuery();
  const fell = useStats<FellOff[]>("evolution/fell_off", { limit: 10 });
  const top = fell.data?.[0];
  return (
    <Card label="Fell off · big before, barely lately" title={top ? `Whatever happened to ${top.title}?` : "Fell off"}>
      {!fell.data ? <Skeleton h={300} /> : !fell.data.length ? <p style={{ color: OV.soft }}>Nobody fell off. Loyal viewer.</p> : (
        <ol className="flex flex-col">
          {fell.data.map((c) => (
            <li key={c.channel_id}>
              <Link to={`/channel/${encodeURIComponent(c.channel_id)}${q}`} className="flex items-center gap-3 border-b py-2 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
                <span className="opacity-75 grayscale"><Avatar src={c.avatar_url} name={c.title} size={36} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-bold">{c.title}</span>
                  <span className="text-[12px]" style={{ color: OV.soft }}>peak {c.peak_year} · last watched {date(c.last_watched)}</span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-ov-display text-[15px] font-extrabold">{num(c.count_before)}</span>
                  <span className="text-[11px]" style={{ color: OV.soft }}>{c.count_recent ? `${c.count_recent} lately` : "none lately"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Discoveries() {
  const { verbed } = useVerb();
  const cr = useCreator();
  const { filters } = useFilters();
  const q = useLinkQuery();
  const disc = useStats<Discovery[]>("evolution/discoveries", { limit: 12 }, { filters: { ...rankingFilters(filters), metric: "time" } });
  if (disc.data && !disc.data.length) return null;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b-2 pb-3" style={{ borderColor: OV.ink }}>
        <span className={kicker} style={{ color: OV.soft }}>New discoveries</span>
        <h2 className="font-ov-display text-[clamp(24px,2.6vw,32px)] font-extrabold leading-tight">
          {filters.range === "all" ? `Your biggest ${cr.many}, and when you found them` : `${cr.Many} you ${verbed} for the first time`}
        </h2>
      </div>
      {!disc.data ? <Skeleton h={180} /> : (
        <ol className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {disc.data.map((c) => (
            <li key={c.channel_id} className="min-w-0">
              <Link to={`/channel/${encodeURIComponent(c.channel_id)}${q}`} className="group flex flex-col items-center gap-1.5 text-center">
                <Avatar src={c.avatar_url} name={c.title} size={84} />
                <span className="w-full truncate text-[14px] font-bold group-hover:underline">{c.title}</span>
                <span className="font-ov-display text-[15px] font-extrabold">{hoursShort(c.time_s)}</span>
                <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>found {date(c.first_watched)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The bar chart race, played smoothly: time runs continuously (about a second per month), values blend between
 *  months and bars glide when they swap places; the date label changes once a month. */
const MS_PER_MONTH = 1000;
const ROW = 40;

function BarRace() {
  const { filters } = useFilters();
  const cr = useCreator();
  // a few extra channels per month, so newcomers slide up from below instead of appearing out of nowhere
  const race = useStats<Race>("evolution/bar_race", { limit: 14 }, { filters: { ...rankingFilters(filters), metric: "time" } });
  const frames = race.data?.frames ?? [];
  const last = Math.max(0, frames.length - 1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setT(last); setPlaying(false); }, [last]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = now - prev;
      prev = now;
      setT((x) => {
        const nx = Math.min(last, x + dt / MS_PER_MONTH);
        if (nx >= last) setPlaying(false);
        return nx;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, last]);
  const colors = useMemo(() => raceColors(frames, RACE_COLORS), [frames]);
  if (race.data && frames.length < 2) return null;
  const rows = raceAt(frames, t, 10);
  const max = Math.max(1, ...rows.map((r) => r.value));
  // the bars flow, the date steps: it names the month the bars are growing into
  const shown = frames.length ? frames[Math.min(last, Math.ceil(t - 1e-6))].month : null;
  const label = shown ? new Date(shown + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
  return (
    <Card label="Bar chart race · hours so far" title={label ? `As of ${label}` : "Bar chart race"}>
      {!race.data ? <Skeleton h={420} /> : (
        <>
          <div className="relative" style={{ height: ROW * 10 }} role="img"
               aria-label={`Top ${cr.many} by hours as of ${label}: ${rows.slice(0, 3).map((r) => race.data!.channels[r.channel_id]?.title).join(", ")}`}>
            {rows.map((r, rank) => {
              const c = race.data!.channels[r.channel_id];
              return (
                // the row glides to its new place (top), the bar itself follows the value frame by frame (no transition)
                <div key={r.channel_id} className="absolute inset-x-0 flex items-center gap-3"
                     style={{ top: rank * ROW, height: ROW - 6, transition: "top 450ms cubic-bezier(.4,0,.2,1)" }}>
                  <span className="w-5 text-right font-ov-display text-[14px] font-extrabold">{rank + 1}</span>
                  <Avatar src={c?.avatar_url} name={c?.title} size={30} />
                  <span className={`w-[150px] shrink-0 truncate ${rank === 0 ? "text-[14px] font-extrabold" : "text-[13px] font-bold"}`}>{c?.title ?? "Unknown"}</span>
                  <span className="relative h-full flex-1">
                    <span className="absolute inset-y-1 left-0 rounded-r-md" style={{ width: `${(r.value / max) * 100}%`, background: colors[r.channel_id] ?? OV.ink }} />
                  </span>
                  <span className="w-[64px] text-right font-shelf-mono text-[12px] tabular-nums">{hoursShort(r.value)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { if (t >= last) setT(0); setPlaying((p) => !p); }}
                    className="min-h-10 rounded-full px-5 text-[14px] font-bold" style={{ background: OV.ink, color: OV.paper }}>
              {playing ? "Pause" : t >= last ? "Replay" : "Run the race"}
            </button>
            <input type="range" min={0} max={last} step={0.01} value={t} aria-label="Date"
                   onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} className="flex-1" style={{ accentColor: OV.accent }} />
          </div>
        </>
      )}
    </Card>
  );
}

function MixByYear() {
  const { verbed } = useVerb();
  const hasCategories = useCapability("categories");
  const [pick, setPick] = useState<"category" | "genre">("category");
  // hovering a piece (or a legend item) dims the others and shows that one's share in every year
  const [hover, setHover] = useState<{ name: string; year?: number } | null>(null);
  const by = hasCategories ? pick : "genre";
  const mix = useStats<Mix>("evolution/mix", { by });
  const d = mix.data;
  const names = d ? Object.keys(d.series) : [];
  const color = (n: string, i: number) => (n === "Other" ? OTHER : MIX_COLORS[i % MIX_COLORS.length]);
  const share = (n: string, yi: number) => (d ? d.series[n][yi] / (names.reduce((s, x) => s + d.series[x][yi], 0) || 1) : 0);
  const yi = hover?.year != null && d ? d.years.indexOf(hover.year) : -1;
  const info = !hover || !d ? `Hover a ${by} to follow it through the years.`
    : yi >= 0 ? `${hover.name} · ${hover.year}: ${pct(share(hover.name, yi))} of what you ${verbed}`
    : `${hover.name}: ${pct(share(hover.name, 0))} in ${d.years[0]}, ${pct(share(hover.name, d.years.length - 1))} in ${d.years[d.years.length - 1]}`;
  return (
    <Card label={`Your mix · share of each ${by} per year`} title={`What you ${verbed}, year by year`}>
      {hasCategories && <Seg label="Group by" value={pick} options={[["category", "Categories"], ["genre", "Genres"]]} onChange={(v) => { setHover(null); setPick(v); }} />}
      {!d ? <Skeleton h={320} /> : !d.years.length ? <p style={{ color: OV.soft }}>Not enough data yet.</p> : (
        <>
          <p aria-live="polite" className="min-h-[24px] text-[15px] font-bold" style={{ color: hover ? OV.ink : OV.soft }}>{info}</p>
          <div className="grid h-[280px] items-stretch gap-2" style={{ gridTemplateColumns: `repeat(${d.years.length},minmax(0,1fr))` }}
               onMouseLeave={() => setHover(null)}>
            {d.years.map((y, yIdx) => (
              <div key={y} className="flex flex-col-reverse overflow-hidden rounded-md border-2" style={{ borderColor: OV.ink }}>
                {names.map((n, i) => {
                  const v = share(n, yIdx);
                  const on = hover?.name === n;
                  return (
                    <span key={n} onMouseEnter={() => setHover({ name: n, year: y })}
                          className="relative flex items-center justify-center transition-opacity duration-150"
                          style={{ height: `${v * 100}%`, background: color(n, i), opacity: hover && !on ? 0.22 : 1 }}>
                      {on && v >= 0.06 && (
                        <span className="rounded-full px-1.5 font-shelf-mono text-[11px] font-medium" style={{ background: OV.paper, color: OV.ink }}>{pct(v)}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="grid font-shelf-mono text-[12px]" style={{ gridTemplateColumns: `repeat(${d.years.length},minmax(0,1fr))` }}>
            {d.years.map((y) => <span key={y} className="text-center" style={hover?.year === y ? { fontWeight: 700 } : undefined}>{y}</span>)}
          </div>
          <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[13px]" onMouseLeave={() => setHover(null)}>
            {names.map((n, i) => (
              <li key={n}>
                <button type="button" onMouseEnter={() => setHover({ name: n })} onFocus={() => setHover({ name: n })} onBlur={() => setHover(null)}
                        aria-pressed={hover?.name === n}
                        className="flex min-h-8 items-center gap-1.5 rounded-full px-2 transition-opacity"
                        style={{ opacity: hover && hover.name !== n ? 0.4 : 1, background: hover?.name === n ? "rgba(26,23,20,0.07)" : "transparent" }}>
                  <span className="h-3 w-3 rounded-[2px]" style={{ background: color(n, i) }} />{n}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
