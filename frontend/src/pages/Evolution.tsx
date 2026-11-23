import { ShowsEvolution } from "../families/shows/Evolution";
import { useHasSeries as useHasSeriesW, usePlatform as usePlatformW } from "../platform";
import { useEffect, useMemo, useState } from "react";
import { Link, tr, useCapability, useHasSeries } from "../platform";
import type { EChartsOption } from "echarts";
import { Pause, Play } from "lucide-react";
import { useMeta, useStats } from "../api";
import { Chart } from "../components/Chart";
import { Avatar, Carousel, MetricToggle, PageTitle, QueryState, Section } from "../components/ui";
import { date, duration, month, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { accent, axisLabel, categorical, ink, muted, otherColor, sub, surface } from "../theme";

export interface ChannelRef { channel_id: string; title?: string | null; avatar_url?: string | null }
export type TopYear = ChannelRef & { year: number; count: number; time_s: number };
export type Discovery = ChannelRef & { first_watched: string; count: number; time_s: number };
export type Loyal = ChannelRef & { years: number; count: number; year_list: number[] };
export type FellOff = ChannelRef & { count_before: number; count_recent: number; last_watched: string; peak_year: number };
interface Race { metric: "count" | "time"; frames: { month: string; top: { channel_id: string; value: number }[] }[]; channels: Record<string, { title: string; avatar_url: string | null }> }
interface Mix { years: number[]; series: Record<string, number[]> }

/** Netflix gets its own version of this page; everything else uses the stats.fm-style one. */
export function Evolution() {
  const platform = usePlatformW();
  const series = useHasSeriesW();
  if (!platform) return null;
  return series ? <ShowsEvolution /> : <StatsEvolution />;
}

function StatsEvolution() {
  const { filters, update } = useFilters();
  const period = rangeLabel(filters);
  const q = useLinkQuery();
  const years = useStats<TopYear[]>("evolution/top_per_year");
  const disc = useStats<Discovery[]>("evolution/discoveries", { limit: 20 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Evolution" subtitle="How your taste changed over the years" />
        <div className="px-1"><MetricToggle value={filters.metric} onChange={(m) => update({ metric: m })} /></div>
      </div>

      <Section title={tr("#1 channel of every year")} subtitle="All time">
        <QueryState q={years} minHeight={170} empty={(d) => !d.length}>
          {(d) => (
            <Carousel>
              {d.map((y) => (
                <Link key={y.year} to={`/year/${y.year}${q}`}
                      className="flex w-[124px] shrink-0 flex-col items-center rounded-card bg-raised/60 p-3 text-center hover:bg-raised">
                  <div className="mb-2 text-lg font-black text-yt-soft">{y.year}</div>
                  <Avatar src={y.avatar_url} name={y.title} size={72} />
                  <div className="mt-2 line-clamp-1 w-full text-sm font-medium">{y.title}</div>
                  <div className="text-xs text-sub">{filters.metric === "time" ? duration(y.time_s) : tr(`${num(y.count)} videos`)}</div>
                </Link>
              ))}
            </Carousel>
          )}
        </QueryState>
      </Section>

      <BarRace />

      <Section title="New discoveries"
               subtitle={filters.range === "all"
                 ? tr("Your biggest channels and when you first found them (pick a time range to see that period's finds)")
                 : tr(`Channels you watched for the first time ever in ${period}`)}>
        <QueryState q={disc} minHeight={160} empty={(d) => !d.length}>
          {(d) => (
            <Carousel>
              {d.map((c) => (
                <Link key={c.channel_id} to={`/channel/${c.channel_id}${q}`} className="flex w-[104px] shrink-0 flex-col items-center text-center">
                  <Avatar src={c.avatar_url} name={c.title} size={88} />
                  <div className="mt-2 line-clamp-1 w-full text-sm font-medium">{c.title}</div>
                  <div className="text-xs text-sub">{filters.metric === "time" ? duration(c.time_s) : tr(`${num(c.count)} videos`)}</div>
                  <div className="text-[11px] text-muted">since {date(c.first_watched)}</div>
                </Link>
              ))}
            </Carousel>
          )}
        </QueryState>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Loyalty />
        <FellOffList />
      </div>

      <MixByYear />
    </div>
  );
}

export function BarRace() {
  const { filters } = useFilters();
  const series = useHasSeries();
  const race = useStats<Race>("evolution/bar_race", { limit: 10 });
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frames = race.data?.frames ?? [];

  useEffect(() => { setI(Math.max(0, frames.length - 1)); setPlaying(false); }, [frames.length]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => {
      if (x >= frames.length - 1) { setPlaying(false); return x; }
      return x + 1;
    }), 650);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const option = useMemo<EChartsOption | null>(() => {
    const d = race.data;
    if (!d || !frames.length) return null;
    const f = frames[Math.min(i, frames.length - 1)];
    const name = (id: string) => d.channels[id]?.title ?? "Unknown";
    const fmt = (v: number) => (d.metric === "time" ? duration(v) : num(v));
    return {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", max: "dataMax", show: false },
      yAxis: {
        type: "category", inverse: true, max: 9,
        data: f.top.map((t) => name(t.channel_id)),
        axisLabel: { ...axisLabel, color: ink, fontSize: 12, width: 130, overflow: "truncate" },
        axisLine: { show: false }, axisTick: { show: false },
        animationDuration: 300, animationDurationUpdate: 300,
      },
      series: [{
        type: "bar", barMaxWidth: 24, // frames arrive sorted; ECharts realtimeSort mislabels bars on jumps
        data: f.top.map((t) => t.value),
        itemStyle: { color: accent, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: sub, fontSize: 11, valueAnimation: true, formatter: (p: { value: unknown }) => fmt(Number(p.value)) },
      }],
      graphic: [{ type: "text", right: 16, bottom: 16, style: { text: month(f.month), fill: muted, font: `900 28px ${series ? "Inter" : "Roboto"}, sans-serif`, opacity: 0.6 } }],
      animationDuration: 0, animationDurationUpdate: 600, animationEasing: "linear", animationEasingUpdate: "linear",
    };
  }, [race.data, frames, i, series]);

  return (
    <Section title="Bar chart race" subtitle={tr(`Your top channels so far, month by month (${rangeLabel(filters)})`)}
             action={frames.length > 1 && (
               <button onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying((p) => !p); }}
                       className={series ? "nf-select" : "flex items-center gap-1.5 rounded-full bg-yt px-3 py-1.5 text-sm font-bold text-white hover:bg-yt-dark"}
                       aria-label={playing ? "Pause" : "Play"}>
                 {/* on Netflix a "Play" button would read as playing a show */}
                 {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : series ? "Run the race" : "Play"}
               </button>
             )}>
      <QueryState q={race} minHeight={360} empty={(d) => !d.frames.length}>
        {() => option && (
          <>
            <Chart option={option} height={360} merge ariaLabel={tr("Top channels bar chart race")} />
            <input type="range" min={0} max={frames.length - 1} value={i} aria-label="Month"
                   onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
                   className="mt-2 w-full accent-yt" />
          </>
        )}
      </QueryState>
    </Section>
  );
}

export function Loyalty() {
  const meta = useMeta().data;
  const loyal = useStats<Loyal[]>("evolution/loyalty", { limit: 15 });
  const q = useLinkQuery();
  const allYears = meta?.years ?? [];
  const seriesUnit = useHasSeries() ? "episodes" : tr("videos");
  return (
    <Section title="Most loyal" subtitle={tr("Channels you kept coming back to, in the most different years (3+ videos a year)")}>
      <QueryState q={loyal} minHeight={300} empty={(d) => !d.length}>
        {(d) => (
          <ol className="flex flex-col">
            {d.map((c, idx) => (
              <li key={c.channel_id}>
                <Link to={`/channel/${c.channel_id}${q}`} className="link-row -mx-2">
                  <span className="w-6 text-center font-black text-sub">{idx + 1}</span>
                  <Avatar src={c.avatar_url} name={c.title} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.title}</div>
                    <div className="mt-1 flex gap-1" aria-label={`watched in ${c.year_list.join(", ")}`}>
                      {allYears.map((y) => (
                        <span key={y} title={String(y)}
                              className={`h-2 w-2 rounded-full ${c.year_list.includes(y) ? "bg-yt-soft" : "bg-line"}`} />
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-sub"><div className="text-sm font-medium text-ink">{c.years} years</div>{num(c.count)} {seriesUnit}</div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

function FellOffList() {
  const fell = useStats<FellOff[]>("evolution/fell_off", { limit: 15 });
  const q = useLinkQuery();
  return (
    <Section title="Fell off" subtitle={tr("Channels you used to watch a lot, but barely in the last year")}>
      <QueryState q={fell} minHeight={300} empty={(d) => !d.length}>
        {(d) => (
          <ol className="flex flex-col">
            {d.map((c) => (
              <li key={c.channel_id}>
                <Link to={`/channel/${c.channel_id}${q}`} className="link-row -mx-2">
                  <Avatar src={c.avatar_url} name={c.title} size={40} className="opacity-80 grayscale" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.title}</div>
                    <div className="text-xs text-sub">peak {c.peak_year} · last watched {date(c.last_watched)}</div>
                  </div>
                  <div className="text-right text-xs text-sub">
                    <div className="text-sm font-medium text-ink">{num(c.count_before)}</div>
                    {c.count_recent ? `${c.count_recent} lately` : "none lately"}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

export function MixByYear() {
  const hasCategories = useCapability("categories");
  const [pick, setBy] = useState<"category" | "genre">("category");
  const by = hasCategories ? pick : "genre";  // platforms without categories (Netflix) only have genres
  const mix = useStats<Mix>("evolution/mix", { by });
  return (
    <Section title="Your mix, year by year" subtitle={`Share of each ${by} per year (all time)`}
             action={hasCategories && (
               <div className="seg" role="group" aria-label="Group by">
                 <button aria-pressed={by === "category"} onClick={() => setBy("category")}>Categories</button>
                 <button aria-pressed={by === "genre"} onClick={() => setBy("genre")}>Genres</button>
               </div>
             )}>
      <QueryState q={mix} minHeight={360} empty={(d) => !d.years.length}>
        {(d) => <MixChart mix={d} />}
      </QueryState>
    </Section>
  );
}

function MixChart({ mix }: { mix: Mix }) {
  const names = Object.keys(mix.series);
  const totals = mix.years.map((_, yi) => names.reduce((s, n) => s + mix.series[n][yi], 0) || 1);
  const color = (n: string, i: number) => (n === "Other" ? otherColor : categorical[i % categorical.length]);
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 8, bottom: 64, containLabel: true },
    xAxis: { type: "category", data: mix.years.map(String), axisLabel, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", max: 1, axisLabel: { ...axisLabel, formatter: (v: number) => pct(v) }, splitLine: { show: false } },
    legend: { bottom: 0, textStyle: { color: sub, fontSize: 11 }, icon: "rect", itemWidth: 10, itemHeight: 10, itemGap: 12 },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
      formatter: (ps: unknown) => {
        const arr = ps as { seriesName: string; value: number; dataIndex: number; color: string }[];
        const yi = arr[0]?.dataIndex ?? 0;
        return `<b>${mix.years[yi]}</b><br/>` + [...arr].reverse().filter((p) => p.value > 0.001)
          .map((p) => `<span style="display:inline-block;width:10px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${pct(p.value)}</b> <span style="color:${sub}">${p.seriesName}</span>`).join("<br/>");
      },
    },
    series: names.map((n, i) => ({
      name: n, type: "bar", stack: "mix", barMaxWidth: 48,
      data: mix.series[n].map((v, yi) => v / totals[yi]),
      itemStyle: { color: color(n, i), borderColor: surface, borderWidth: 1 },
      emphasis: { focus: "series" },
    })),
  };
  return <Chart option={option} height={380} ariaLabel="Category share by year" />;
}
