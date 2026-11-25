/* Patterns in the new look: when you watch. Main: the hour of day. Secondary: day x hour and weekdays vs weekends.
   Extras: every day, and month by month. Charts are plain HTML so they match the cream page exactly. */
import { useState } from "react";
import { DayPoint, HourPoint, MonthPoint, useMeta, useStats } from "../api";
import { useFilters } from "../filters";
import { duration, num } from "../format";
import { useCapability } from "../platform";
import { OV, PageBody, PageHeader, ScrollRow, Seg, Skeleton, StatsFrame, kicker, useNoun } from "./kit";
import { HeatLegend, HoverBars, Readout, Ticks } from "./charts";
import {
  DAYS, calendarWeeks, clockFacts, heatColor, heatLevel, heatRange, hourLabel, oneIn, periodTitle, weekdayFacts, weekendLine,
} from "./takeaways";

type Measure = "count" | "time";
interface WW { count: number; time_s: number; days: number; avg_count_per_day: number; avg_time_s_per_day: number }

const amount = (m: Measure, v: number, n: string) => (m === "time" ? duration(v) : `${num(v)} ${n}`);

export function PatternsPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const [m, setM] = useState<Measure>("count");
  const n = useNoun();
  // some histories have dates but no times (Netflix's quick download): then the day of the week leads
  const hasTimes = useCapability("time_of_day");
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock", {}, { enabled: hasTimes });
  const heat = useStats<{ data: { count: number[][]; time_s: number[][] } }>("patterns/heatmap");
  const ww = useStats<{ data: { weekday: WW; weekend: WW } }>("patterns/weekday_weekend");
  const cal = useStats<{ data: DayPoint[] }>("patterns/calendar");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const f = clock.data ? clockFacts(clock.data.data) : null;
  const w = heat.data ? weekdayFacts(heat.data.data.count) : null;
  const title = !hasTimes ? (!heat.data ? "When you watch" : w ? `Mostly on ${w.busiest}s.` : "Nothing in this period")
    : !clock.data ? "When you watch" : !f ? "Nothing in this period" : f.night >= 0.2 ? "Up past midnight." : `Most of it around ${hourLabel(f.peak)}.`;

  return (
    <StatsFrame>
      <PageHeader label={`Patterns · ${periodTitle(filters, meta?.today)}`} title={title}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-shelf-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: OV.mute }} aria-hidden>Count</span>
          <Seg label="Count" dark value={m} options={[["count", n.Many], ["time", "Hours"]]} onChange={setM} />
        </div>
      </PageHeader>
      <PageBody>
        {hasTimes ? (
          <>
            <HourChart data={clock.data?.data} m={m} />
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <DayHour grid={heat.data ? (m === "time" ? heat.data.data.time_s : heat.data.data.count) : undefined} m={m} />
              <Weekends ww={ww.data?.data} m={m} counts={heat.data?.data.count} />
            </div>
          </>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Weekdays grid={heat.data ? (m === "time" ? heat.data.data.time_s : heat.data.data.count) : undefined} m={m} />
            <Weekends ww={ww.data?.data} m={m} counts={heat.data?.data.count} busiest={false} />
          </div>
        )}
        <EveryDay days={cal.data?.data} m={m} />
        <Monthly months={monthly.data?.data} m={m} />
      </PageBody>
    </StatsFrame>
  );
}

function Card({ label, title, children, className = "" }: { label: string; title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6 ${className}`} style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        {title && <h2 className="font-ov-display text-[26px] font-extrabold leading-tight">{title}</h2>}
      </div>
      {children}
    </section>
  );
}

/** Dates without times: the seven days of the week, big, in the dark main card. */
function Weekdays({ grid, m }: { grid?: number[][]; m: Measure }) {
  const n = useNoun().many;
  if (!grid) return <Skeleton h={320} />;
  const totals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const top = totals.indexOf(Math.max(...totals));
  const names = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  return (
    <section className="flex flex-col gap-3 rounded-2xl p-5 sm:p-7" style={{ background: OV.ink, color: OV.paper }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span><span className="font-ov-display text-[34px] font-extrabold" style={{ color: OV.mustard }}>{names[top].slice(0, -1)}</span>
          <span className="ml-2 text-[17px]">is your busiest day</span></span>
        <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>Your history has dates but no times, so it's by day, not hour</span>
      </div>
      <HoverBars dark height={220} gap={10} radius={6} hint="Hover a day to see it." ariaLabel={`${m === "time" ? "Hours" : n} by day of the week. Busiest: ${names[top]}.`}
                 bars={totals.map((t, i) => ({ key: DAYS[i], label: names[i], value: t, display: amount(m, t, n), color: i === top ? OV.mustard : "#5E554A" }))}
                 ticks={<Ticks dark labels={DAYS} />} />
    </section>
  );
}

function HourChart({ data, m }: { data?: HourPoint[]; m: Measure }) {
  const n = useNoun().many;
  if (!data) return <Skeleton h={320} />;
  const v = (h: HourPoint) => (m === "time" ? h.time_s : h.count);
  const f = clockFacts(data);
  const peak = data.reduce((a, b) => (v(b) > v(a) ? b : a)).hour;
  return (
    <section className="flex flex-col gap-3 rounded-2xl p-5 sm:p-7" style={{ background: OV.ink, color: OV.paper }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span><span className="font-ov-display text-[34px] font-extrabold" style={{ color: OV.mustard }}>{hourLabel(peak)}</span>
          <span className="ml-2 text-[17px]">is your busiest hour</span></span>
        {f && <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{oneIn(f.night)} {n} started between midnight and 5 am</span>}
      </div>
      <HoverBars dark height={220} gap={4} radius={4} hint="Hover an hour to see it."
                 ariaLabel={`${m === "time" ? "Hours" : n} by hour of day. Busiest: ${hourLabel(peak)}.`}
                 bars={data.map((h) => ({ key: String(h.hour), label: `${hourLabel(h.hour)} to ${hourLabel((h.hour + 1) % 24)}`, value: v(h), display: amount(m, v(h), n),
                                          color: h.hour === peak ? OV.mustard : h.hour < 5 ? "#8E8170" : "#5E554A" }))}
                 ticks={<Ticks dark labels={[0, 3, 6, 9, 12, 15, 18, 21].map(hourLabel)} />} />
    </section>
  );
}

function DayHour({ grid, m }: { grid?: number[][]; m: Measure }) {
  const n = useNoun().many;
  const [cell, setCell] = useState<[number, number] | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  if (!grid) return <Skeleton h={300} />;
  const max = Math.max(1, ...grid.flat());
  let best = [0, 0];
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > grid[best[0]][best[1]]) best = [d, h]; }));
  const days = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  const [lo, hi] = level ? heatRange(level, max) : [0, 0];
  const info = cell ? `${days[cell[0]]}, ${hourLabel(cell[1])} to ${hourLabel((cell[1] + 1) % 24)} · ${amount(m, grid[cell[0]][cell[1]], n)}`
    : level != null ? (level === 0 ? "Hours you never watched" : `Hours with ${amount(m, lo, n)} to ${amount(m, hi, n)}`)
    : "Hover a square to see it, or a shade to light up those hours.";
  return (
    <Card label="Day × hour" title={`${days[best[0]]} around ${hourLabel(best[1])}`}>
      <Readout text={info} active={!!cell || level != null} />
      <ScrollRow bg={OV.paper}>
        <div onMouseLeave={() => setCell(null)} className="grid min-w-[520px] gap-[3px]" style={{ gridTemplateColumns: "38px repeat(24,minmax(0,1fr))" }}
             role="img" aria-label={`Busiest: ${days[best[0]]} around ${hourLabel(best[1])}. Darker means more.`}>
          {grid.map((row, d) => [
            <span key={`l${d}`} className="self-center font-shelf-mono text-[11px]">{DAYS[d]}</span>,
            ...row.map((n, h) => {
              const on = cell?.[0] === d && cell?.[1] === h;
              return <span key={`${d}-${h}`} onMouseEnter={() => setCell([d, h])} className="aspect-square rounded-[3px] transition-opacity duration-150"
                           style={{ background: heatColor(n, max), opacity: level != null && heatLevel(n, max) !== level ? 0.18 : 1,
                                    boxShadow: on ? `0 0 0 2px ${OV.ink}` : undefined }} />;
            }),
          ])}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={`h${h}`} className="overflow-visible whitespace-nowrap font-shelf-mono text-[10px]" style={{ color: OV.soft }}>{h % 6 === 0 ? hourLabel(h) : ""}</span>
          ))}
        </div>
      </ScrollRow>
      <HeatLegend level={level} setLevel={setLevel} />
    </Card>
  );
}

function Weekends({ ww, m, counts, busiest = true }: { ww?: { weekday: WW; weekend: WW }; m: Measure; counts?: number[][]; busiest?: boolean }) {
  const n = useNoun().many;
  if (!ww) return <Skeleton h={300} />;
  const per = (x: WW) => (m === "time" ? x.avg_time_s_per_day : x.avg_count_per_day);
  const w = counts ? weekdayFacts(counts) : null;
  const max = Math.max(per(ww.weekday), per(ww.weekend), 1e-9);
  const fmt = (x: WW) => (m === "time" ? duration(per(x)) : per(x).toFixed(1));
  return (
    <Card label="Weekdays vs weekends" title={weekendLine(per(ww.weekday), per(ww.weekend))}>
      <div className="flex flex-col gap-3">
        {([["Weekday", ww.weekday, OV.sand], ["Weekend", ww.weekend, OV.teal]] as const).map(([l, x, c]) => (
          <div key={l} className="flex flex-col gap-1">
            <span className="flex justify-between text-[14px]"><span>{l}</span>
              <span><strong className="font-ov-display text-[18px]">{fmt(x)}</strong> {m === "time" ? "a day" : `${n} a day`}</span></span>
            <span className="h-4 overflow-hidden rounded-md border-2" style={{ borderColor: OV.ink }}>
              <span className="block h-full" style={{ width: `${(per(x) / max) * 100}%`, background: c }} />
            </span>
          </div>
        ))}
      </div>
      {busiest && w && <p className="text-[14px]" style={{ color: OV.soft }}><strong style={{ color: OV.ink }}>{w.busiest}</strong> is your busiest day overall.</p>}
    </Card>
  );
}

/** Every day as a calendar: weeks run left to right (Monday on top), squares grow to fill the card for short
 *  periods and keep a readable size (scrolling) for long ones. Hover a day for its numbers; hover a legend shade
 *  to light only the days at that level. */
function EveryDay({ days, m }: { days?: DayPoint[]; m: Measure }) {
  const n = useNoun().many;
  const [day, setDay] = useState<DayPoint | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  if (!days) return <Skeleton h={180} />;
  const v = (d: DayPoint) => (m === "time" ? d.time_s : d.count);
  const max = Math.max(1, ...days.map(v));
  const weeks = calendarWeeks(days);
  const active = days.filter((d) => d.count > 0).length;
  const W = weeks.length;
  const unit = m === "time" ? "" : ` ${n}`;
  const fmt = (x: number) => (m === "time" ? duration(x) : num(x));
  const nice = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const info = day ? `${nice(day.date)} · ${day.count ? `${num(day.count)} ${n} · ${duration(day.time_s)}` : "nothing watched"}`
    : level != null ? (level === 0 ? "Days you didn't watch" : `Days with ${fmt(heatRange(level, max)[0])}–${fmt(heatRange(level, max)[1])}${unit}`)
    : "Hover a day to see it, or a shade to light up those days.";
  // a month name over the first week that holds its 1st (and over the first column)
  const monthOf = (w: (DayPoint | null)[], i: number) => {
    const first = w.find((d) => d && (d.date.endsWith("-01") || i === 0));
    return first ? new Date(first.date + "T00:00:00").toLocaleDateString("en-US", { month: "short" }) : "";
  };
  return (
    <Card label="Every day" title={`You watched on ${num(active)} of ${num(days.length)} days`}>
      <Readout text={info} active={!!day || level != null} />
      <ScrollRow bg={OV.paper} className="pb-1">
        <div onMouseLeave={() => setDay(null)} className="grid gap-[3px]" role="img" aria-label={`One square per day. You watched on ${active} of ${days.length} days.`}
             style={{ gridTemplateColumns: `30px repeat(${W},minmax(0,1fr))`, width: `min(100%, ${W * 30 + 34}px)`, minWidth: `${W * 12 + 34}px` }}>
          <span />
          {weeks.map((w, i) => <span key={`m${i}`} className="overflow-visible whitespace-nowrap font-shelf-mono text-[10px]" style={{ color: OV.soft }}>{monthOf(w, i)}</span>)}
          {[0, 1, 2, 3, 4, 5, 6].map((r) => [
            <span key={`d${r}`} className="self-center font-shelf-mono text-[10px]" style={{ color: OV.soft }}>{r % 2 === 0 ? DAYS[r] : ""}</span>,
            ...weeks.map((w, i) => {
              const d = w[r];
              if (!d) return <span key={`${i}-${r}`} />;
              const lv = heatLevel(v(d), max);
              const on = day?.date === d.date;
              return (
                <span key={`${i}-${r}`} onMouseEnter={() => setDay(d)}
                      className="aspect-square rounded-[3px] transition-opacity duration-150"
                      style={{ background: heatColor(v(d), max), opacity: level != null && lv !== level ? 0.18 : 1,
                               boxShadow: on ? `0 0 0 2px ${OV.ink}` : undefined }} />
              );
            }),
          ])}
        </div>
      </ScrollRow>
      <HeatLegend level={level} setLevel={setLevel} />
    </Card>
  );
}

function Monthly({ months, m }: { months?: MonthPoint[]; m: Measure }) {
  const n = useNoun().many;
  if (!months) return <Skeleton h={240} />;
  if (!months.length) return null;
  const v = (x: MonthPoint) => (m === "time" ? x.time_s : x.count);
  const best = months.reduce((a, b) => (v(b) > v(a) ? b : a));
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const many = months.length > 24;
  return (
    <Card label="Month by month" title={`${label(best.month)} was your biggest month`}>
      <HoverBars height={180} hint="Hover a month to see it." ariaLabel={`${m === "time" ? "Hours" : n} per month. Biggest: ${label(best.month)}.`}
                 bars={months.map((x) => ({ key: x.month, label: label(x.month), value: v(x), display: amount(m, v(x), n), color: x.month === best.month ? OV.accent : OV.ink }))}
                 ticks={<Ticks labels={months.map((x) => (many ? (x.month.endsWith("-01") ? x.month.slice(0, 4) : "")
                                                              : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })))} />} />
    </Card>
  );
}
