/* Patterns on Netflix: when you watch, in Netflix reds. Dates-only data gets a day-of-week chart
   instead of a clock (there are no real times to show). */
import { DayPoint, HourPoint, MonthPoint, useStats } from "../../api";
import { useCapability, usePlatform } from "../../platform";
import { QueryState, Section, WatchTimeInfo } from "../../components/ui";
import { CalendarHeat, MonthlyBars, WatchClock, WeekHeatmap, useMeasure } from "../../components/charts";
import { FigureStrip, PageHead, RED, Toggle, hours } from "./ui";
import { duration, month, num } from "../../format";
import { rangeLabel, useFilters } from "../../filters";

interface WW { count: number; time_s: number; days: number; avg_count_per_day: number; avg_time_s_per_day: number }
type Grid = { count: number[][]; time_s: number[][] };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ShowsPatterns() {
  const name = usePlatform()?.name ?? "Netflix";
  const { filters } = useFilters();
  const hasTimes = useCapability("time_of_day");
  const [measure, setMeasure] = useMeasure();
  const heat = useStats<{ data: Grid }>("patterns/heatmap");
  const cal = useStats<{ data: DayPoint[] }>("patterns/calendar");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const ww = useStats<{ data: { weekday: WW; weekend: WW } }>("patterns/weekday_weekend");
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock", {}, { enabled: hasTimes });

  // per weekday totals (the day of the week is real even when the time isn't)
  const grid = heat.data?.data;
  const byDay = grid ? DAYS.map((_, d) => ({ count: grid.count[d].reduce((a, b) => a + b, 0), time_s: grid.time_s[d].reduce((a, b) => a + b, 0) })) : [];
  const val = (x: { count: number; time_s: number }) => (measure === "time" ? x.time_s : x.count);
  const topDay = byDay.length ? byDay.reduce((best, x, i) => (val(x) > val(byDay[best]) ? i : best), 0) : -1;
  const months = monthly.data?.data ?? [];
  const topMonth = months.length ? months.reduce((a, b) => (val(b) > val(a) ? b : a)) : null;
  const days = cal.data?.data ?? [];
  const topDate = days.length ? days.reduce((a, b) => (val(b) > val(a) ? b : a)) : null;
  const show = (x: { count: number; time_s: number }) => (measure === "time" ? hours(x.time_s) : `${num(x.count)} titles`);

  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Patterns" subtitle={`When you watch, from ${rangeLabel(filters)}`}>
        <div className="flex items-center gap-2">
          <Toggle label="Measure" value={measure} onChange={setMeasure} options={[["count", "Titles"], ["time", "Time"]]} />
          {measure === "time" && <WatchTimeInfo />}
        </div>
      </PageHead>

      <FigureStrip items={[
        { label: "Busiest weekday", value: topDay >= 0 ? DAYS[topDay] : "–", color: RED, sub: topDay >= 0 ? show(byDay[topDay]) : undefined },
        { label: "Busiest month", value: topMonth ? month(topMonth.month) : "–", sub: topMonth ? show(topMonth) : undefined },
        { label: "Biggest day", value: topDate ? new Date(topDate.date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "–", sub: topDate ? show(topDate) : undefined },
        ww.data ? { label: "Weekend vs weekday", value: `${ww.data.data.weekend.avg_count_per_day.toFixed(1)} / ${ww.data.data.weekday.avg_count_per_day.toFixed(1)}`,
                    sub: `titles a day · ${duration(ww.data.data.weekend.avg_time_s_per_day)} vs ${duration(ww.data.data.weekday.avg_time_s_per_day)}` }
                : { label: "Weekend vs weekday", value: "–" },
      ]} />

      {hasTimes ? (
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
          <Section title="Watch clock" subtitle="Each bar is one hour of the day" className="lg:col-span-2">
            <QueryState q={clock} minHeight={340}>{(d) => <WatchClock data={d.data} measure={measure} height={340} />}</QueryState>
          </Section>
          <Section title="Day × hour" subtitle="Brighter = more watching" className="lg:col-span-3">
            <QueryState q={heat} minHeight={340}>{(d) => <WeekHeatmap grid={d.data} measure={measure} height={340} />}</QueryState>
          </Section>
        </div>
      ) : (
        <Section title="Day of the week" subtitle={`${name === "Netflix" ? "Netflix's quick download" : `Your ${name} history`} has dates but no times, so this is by day rather than by hour`}>
          <QueryState q={heat} minHeight={220}>
            {() => <DayBars byDay={byDay.map(val)} top={topDay} format={(v) => (measure === "time" ? hours(v) : num(v))} />}
          </QueryState>
        </Section>
      )}

      <Section title="Every day" subtitle="One square per day · brighter = more">
        <QueryState q={cal} minHeight={160} empty={(d) => !d.data.length}>
          {(d) => (
            <div className="no-scrollbar -mx-[4%] overflow-x-auto px-[4%]">
              <div className="min-w-[1010px]"><CalendarHeat data={d.data} measure={measure} /></div>
            </div>
          )}
        </QueryState>
      </Section>

      <Section title="Month by month" subtitle={measure === "time" ? "Estimated hours per month" : "Titles per month"}>
        <QueryState q={monthly} minHeight={260} empty={(d) => !d.data.length}>
          {(d) => <MonthlyBars data={d.data} measure={measure} />}
        </QueryState>
      </Section>
    </div>
  );
}

/** Seven vertical bars, the busiest in red. Plain HTML, so it reads cleanly at any width. */
function DayBars({ byDay, top, format }: { byDay: number[]; top: number; format: (v: number) => string }) {
  const max = Math.max(1, ...byDay);
  return (
    <div className="flex h-[220px] items-end gap-2 sm:gap-4" role="img"
         aria-label={DAYS.map((d, i) => `${d} ${format(byDay[i])}`).join(", ")}>
      {byDay.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className={`text-[12px] tabular ${i === top ? "font-bold text-white" : "text-[#b3b3b3]"}`}>{format(v)}</span>
          <div className="w-full max-w-[72px] rounded-t-[3px]" style={{ height: `${(v / max) * 150}px`, background: i === top ? RED : "#5a5a5a" }} />
          <span className={`text-[12px] ${i === top ? "font-bold text-white" : "text-[#808080]"}`}>{DAYS[i].slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}
