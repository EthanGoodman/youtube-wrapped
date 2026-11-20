import { DayPoint, HourPoint, MonthPoint, useStats } from "../api";
import { CalendarHeat, MeasureToggle, MonthlyBars, WatchClock, WeekHeatmap, useMeasure } from "../components/charts";
import { PageTitle, QueryState, Section, StatTile, WatchTimeInfo } from "../components/ui";
import { duration, hourLabel, num } from "../format";
import { rangeLabel, useFilters } from "../filters";

interface WW {
  count: number;
  time_s: number;
  days: number;
  avg_count_per_day: number;
  avg_time_s_per_day: number;
}

export function Patterns() {
  const { filters } = useFilters();
  const [measure, setMeasure] = useMeasure();
  const period = rangeLabel(filters);
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const heat = useStats<{ data: { count: number[][]; time_s: number[][] } }>("patterns/heatmap");
  const cal = useStats<{ data: DayPoint[] }>("patterns/calendar");
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const ww = useStats<{ data: { weekday: WW; weekend: WW } }>("patterns/weekday_weekend");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Patterns" subtitle={`When you watch, from ${period}`} />
        <div className="flex items-center gap-2 px-1">
          <MeasureToggle value={measure} onChange={setMeasure} />
          {measure === "time" && <WatchTimeInfo />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Watch clock" subtitle="Each bar is one hour of the day" className="lg:col-span-2">
          <QueryState q={clock} minHeight={340} empty={(d) => !d.data.some((h) => h.count)}>
            {(d) => {
              const peak = d.data.reduce((a, b) => ((measure === "time" ? b.time_s > a.time_s : b.count > a.count) ? b : a));
              return (
                <>
                  <WatchClock data={d.data} measure={measure} height={340} />
                  <p className="text-center text-sm text-sub">
                    Peak hour: <span className="font-medium text-ink">{hourLabel(peak.hour)}–{hourLabel((peak.hour + 1) % 24)}</span>
                  </p>
                </>
              );
            }}
          </QueryState>
        </Section>
        <Section title="Day × hour" subtitle="Darker red = more watching" className="lg:col-span-3">
          <QueryState q={heat} minHeight={340}>
            {(d) => <WeekHeatmap grid={d.data} measure={measure} height={340} />}
          </QueryState>
        </Section>
      </div>

      <Section title="Weekdays vs weekends" subtitle="Average per day">
        <QueryState q={ww} minHeight={100}>
          {({ data: { weekday, weekend } }) => (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatTile label="Weekday videos / day" value={num(weekday.avg_count_per_day)} hint={`${num(weekday.days)} weekdays`} />
              <StatTile label="Weekend videos / day" value={num(weekend.avg_count_per_day)} hint={`${num(weekend.days)} weekend days`} />
              <StatTile label="Weekday time / day" value={duration(weekday.avg_time_s_per_day)} info={<WatchTimeInfo />} />
              <StatTile label="Weekend time / day" value={duration(weekend.avg_time_s_per_day)} info={<WatchTimeInfo />} />
            </div>
          )}
        </QueryState>
      </Section>

      <Section title="Every day" subtitle="One square per day">
        <QueryState q={cal} minHeight={160} empty={(d) => !d.data.length}>
          {(d) => (
            <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="min-w-[1010px]"><CalendarHeat data={d.data} measure={measure} /></div>
            </div>
          )}
        </QueryState>
      </Section>

      <Section title="Month by month" subtitle={measure === "time" ? "Estimated watch time per month" : "Videos per month"}>
        <QueryState q={monthly} minHeight={260} empty={(d) => !d.data.length}>
          {(d) => <MonthlyBars data={d.data} measure={measure} />}
        </QueryState>
      </Section>
    </div>
  );
}
