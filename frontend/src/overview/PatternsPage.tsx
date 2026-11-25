/* Patterns in the new look: when you watch. Main: the hour of day. Secondary: day x hour and weekdays vs weekends.
   Extras: every day, and month by month. Charts are plain HTML so they match the cream page exactly. */
import { useState } from "react";
import { DayPoint, HourPoint, MonthPoint, useMeta, useStats } from "../api";
import { useFilters } from "../filters";
import { duration, num } from "../format";
import { OV, PageBody, PageHeader, Seg, Skeleton, StatsFrame, kicker } from "./kit";
import {
  DAYS, HEAT, calendarWeeks, clockFacts, heatColor, heatLevel, heatRange, hourLabel, oneIn, periodTitle, weekdayFacts, weekendLine,
} from "./takeaways";

type Measure = "count" | "time";
interface WW { count: number; time_s: number; days: number; avg_count_per_day: number; avg_time_s_per_day: number }

const amount = (m: Measure, v: number) => (m === "time" ? duration(v) : `${num(v)} videos`);

export function PatternsPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const [m, setM] = useState<Measure>("count");
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const heat = useStats<{ data: { count: number[][]; time_s: number[][] } }>("patterns/heatmap");
  const ww = useStats<{ data: { weekday: WW; weekend: WW } }>("patterns/weekday_weekend");
  const cal = useStats<{ data: DayPoint[] }>("patterns/calendar");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const f = clock.data ? clockFacts(clock.data.data) : null;
  const title = !clock.data ? "When you watch" : !f ? "Nothing in this period" : f.night >= 0.2 ? "Up past midnight." : `Most of it around ${hourLabel(f.peak)}.`;

  return (
    <StatsFrame>
      <PageHeader label={`Patterns · ${periodTitle(filters, meta?.today)}`} title={title}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-shelf-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: OV.mute }} aria-hidden>Count</span>
          <Seg label="Count" dark value={m} options={[["count", "Videos"], ["time", "Hours"]]} onChange={setM} />
        </div>
      </PageHeader>
      <PageBody>
        <HourChart data={clock.data?.data} m={m} />
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <DayHour grid={heat.data ? (m === "time" ? heat.data.data.time_s : heat.data.data.count) : undefined} m={m} />
          <Weekends ww={ww.data?.data} m={m} counts={heat.data?.data.count} />
        </div>
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

function HourChart({ data, m }: { data?: HourPoint[]; m: Measure }) {
  if (!data) return <Skeleton h={320} />;
  const v = (h: HourPoint) => (m === "time" ? h.time_s : h.count);
  const max = Math.max(1, ...data.map(v));
  const f = clockFacts(data);
  const peak = data.reduce((a, b) => (v(b) > v(a) ? b : a)).hour;
  return (
    <section className="flex flex-col gap-4 rounded-2xl p-5 sm:p-7" style={{ background: OV.ink, color: OV.paper }}
             aria-label={`${m === "time" ? "Hours" : "Videos"} by hour of day. Busiest: ${hourLabel(peak)}.`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span><span className="font-ov-display text-[34px] font-extrabold" style={{ color: OV.mustard }}>{hourLabel(peak)}</span>
          <span className="ml-2 text-[17px]">is your busiest hour</span></span>
        {f && <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{oneIn(f.night)} videos started between midnight and 5 am</span>}
      </div>
      <div aria-hidden className="grid h-[220px] items-end gap-[4px]" style={{ gridTemplateColumns: "repeat(24,minmax(0,1fr))" }}>
        {data.map((h) => (
          <span key={h.hour} title={`${hourLabel(h.hour)}: ${amount(m, v(h))}`} className="rounded-t-[4px]"
                style={{ height: `${Math.max(2, (v(h) / max) * 100)}%`, background: h.hour === peak ? OV.mustard : h.hour < 5 ? "#8E8170" : "#5E554A" }} />
        ))}
      </div>
      <div aria-hidden className="grid font-shelf-mono text-[11px]" style={{ gridTemplateColumns: "repeat(8,minmax(0,1fr))", color: OV.mute }}>
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h}>{hourLabel(h)}</span>)}
      </div>
    </section>
  );
}

function DayHour({ grid, m }: { grid?: number[][]; m: Measure }) {
  if (!grid) return <Skeleton h={300} />;
  const max = Math.max(1, ...grid.flat());
  let best = [0, 0];
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > grid[best[0]][best[1]]) best = [d, h]; }));
  const days = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  return (
    <Card label="Day × hour" title={`${days[best[0]]} around ${hourLabel(best[1])}`}>
      <div className="no-scrollbar overflow-x-auto">
        <div className="grid min-w-[520px] gap-[3px]" style={{ gridTemplateColumns: "38px repeat(24,minmax(0,1fr))" }}
             role="img" aria-label={`Busiest: ${days[best[0]]} around ${hourLabel(best[1])}. Darker means more.`}>
          {grid.map((row, d) => [
            <span key={`l${d}`} className="self-center font-shelf-mono text-[11px]">{DAYS[d]}</span>,
            ...row.map((n, h) => <span key={`${d}-${h}`} title={`${DAYS[d]} ${hourLabel(h)}: ${amount(m, n)}`}
                                       className="aspect-square rounded-[3px]" style={{ background: heatColor(n, max) }} />),
          ])}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={`h${h}`} className="overflow-visible whitespace-nowrap font-shelf-mono text-[10px]" style={{ color: OV.soft }}>{h % 6 === 0 ? hourLabel(h) : ""}</span>
          ))}
        </div>
      </div>
      <Legend />
    </Card>
  );
}

function Legend() {
  return (
    <span className="flex items-center gap-1.5 font-shelf-mono text-[11px]" style={{ color: OV.soft }} aria-hidden>
      Less {HEAT.map((c) => <span key={c} className="h-3 w-3 rounded-[2px]" style={{ background: c }} />)} More
    </span>
  );
}

function Weekends({ ww, m, counts }: { ww?: { weekday: WW; weekend: WW }; m: Measure; counts?: number[][] }) {
  if (!ww) return <Skeleton h={300} />;
  const per = (x: WW) => (m === "time" ? x.avg_time_s_per_day : x.avg_count_per_day);
  const w = counts ? weekdayFacts(counts) : null;
  const max = Math.max(per(ww.weekday), per(ww.weekend), 1e-9);
  const fmt = (x: WW) => (m === "time" ? duration(per(x)) : `${num(Math.round(per(x) * 10) / 10)}`);
  return (
    <Card label="Weekdays vs weekends" title={weekendLine(per(ww.weekday), per(ww.weekend))}>
      <div className="flex flex-col gap-3">
        {([["Weekday", ww.weekday, OV.sand], ["Weekend", ww.weekend, OV.teal]] as const).map(([l, x, c]) => (
          <div key={l} className="flex flex-col gap-1">
            <span className="flex justify-between text-[14px]"><span>{l}</span>
              <span><strong className="font-ov-display text-[18px]">{fmt(x)}</strong> {m === "time" ? "a day" : "videos a day"}</span></span>
            <span className="h-4 overflow-hidden rounded-md border-2" style={{ borderColor: OV.ink }}>
              <span className="block h-full" style={{ width: `${(per(x) / max) * 100}%`, background: c }} />
            </span>
          </div>
        ))}
      </div>
      {w && <p className="text-[14px]" style={{ color: OV.soft }}><strong style={{ color: OV.ink }}>{w.busiest}</strong> is your busiest day overall.</p>}
    </Card>
  );
}

/** Every day as a calendar: weeks run left to right (Monday on top), squares grow to fill the card for short
 *  periods and keep a readable size (scrolling) for long ones. Hover a day for its numbers; hover a legend shade
 *  to light only the days at that level. */
function EveryDay({ days, m }: { days?: DayPoint[]; m: Measure }) {
  const [day, setDay] = useState<DayPoint | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  if (!days) return <Skeleton h={180} />;
  const v = (d: DayPoint) => (m === "time" ? d.time_s : d.count);
  const max = Math.max(1, ...days.map(v));
  const weeks = calendarWeeks(days);
  const active = days.filter((d) => d.count > 0).length;
  const W = weeks.length;
  const unit = m === "time" ? "" : " videos";
  const fmt = (x: number) => (m === "time" ? duration(x) : num(x));
  const nice = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const info = day ? `${nice(day.date)} · ${day.count ? `${num(day.count)} videos · ${duration(day.time_s)}` : "nothing watched"}`
    : level != null ? (level === 0 ? "Days you didn't watch" : `Days with ${fmt(heatRange(level, max)[0])}–${fmt(heatRange(level, max)[1])}${unit}`)
    : "Hover a day to see it, or a shade to light up those days.";
  // a month name over the first week that holds its 1st (and over the first column)
  const monthOf = (w: (DayPoint | null)[], i: number) => {
    const first = w.find((d) => d && (d.date.endsWith("-01") || i === 0));
    return first ? new Date(first.date + "T00:00:00").toLocaleDateString("en-US", { month: "short" }) : "";
  };
  return (
    <Card label="Every day" title={`You watched on ${num(active)} of ${num(days.length)} days`}>
      <p aria-live="polite" className="min-h-[22px] text-[15px] font-bold" style={{ color: day || level != null ? OV.ink : OV.soft }}>{info}</p>
      <div className="no-scrollbar overflow-x-auto pb-1" onMouseLeave={() => setDay(null)}>
        <div className="grid gap-[3px]" role="img" aria-label={`One square per day. You watched on ${active} of ${days.length} days.`}
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
      </div>
      <span className="flex items-center gap-1 font-shelf-mono text-[11px]" style={{ color: OV.soft }} onMouseLeave={() => setLevel(null)}>
        Less
        {HEAT.map((c, i) => (
          <button key={c} type="button" aria-label={i === 0 ? "Days you didn't watch" : `Days at level ${i} of ${HEAT.length - 1}`}
                  onMouseEnter={() => setLevel(i)} onFocus={() => setLevel(i)} onBlur={() => setLevel(null)}
                  className="flex h-7 w-7 items-center justify-center rounded">
            <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: c, boxShadow: level === i ? `0 0 0 2px ${OV.ink}` : undefined }} />
          </button>
        ))}
        More
      </span>
    </Card>
  );
}

function Monthly({ months, m }: { months?: MonthPoint[]; m: Measure }) {
  if (!months) return <Skeleton h={240} />;
  if (!months.length) return null;
  const v = (x: MonthPoint) => (m === "time" ? x.time_s : x.count);
  const max = Math.max(1, ...months.map(v));
  const best = months.reduce((a, b) => (v(b) > v(a) ? b : a));
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const many = months.length > 24;
  return (
    <Card label="Month by month" title={`${label(best.month)} was your biggest month`}>
      <div className="grid h-[180px] items-end gap-[3px]" style={{ gridTemplateColumns: `repeat(${months.length},minmax(0,1fr))` }}
           role="img" aria-label={`${m === "time" ? "Hours" : "Videos"} per month. Biggest: ${label(best.month)}.`}>
        {months.map((x) => (
          <span key={x.month} title={`${label(x.month)}: ${amount(m, v(x))}`} className="rounded-t-[3px]"
                style={{ height: `${Math.max(1, (v(x) / max) * 100)}%`, background: x.month === best.month ? OV.accent : OV.ink }} />
        ))}
      </div>
      <div aria-hidden className="grid font-shelf-mono text-[10px]" style={{ gridTemplateColumns: `repeat(${months.length},minmax(0,1fr))`, color: OV.soft }}>
        {months.map((x) => (
          <span key={x.month} className="overflow-visible whitespace-nowrap">
            {many ? (x.month.endsWith("-01") ? x.month.slice(0, 4) : "") : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })}
          </span>
        ))}
      </div>
    </Card>
  );
}
