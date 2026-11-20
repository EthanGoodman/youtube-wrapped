import { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Link, tr, useCapability, useHasSeries, usePlatform } from "../platform";
import type { EChartsOption } from "echarts";
import { ExternalLink, Sparkles } from "lucide-react";
import { HourPoint, MonthPoint, Overview, RankedItem, useStats } from "../api";
import { Chart } from "../components/Chart";
import { MeasureToggle, MonthlyBars, WatchClock, useMeasure } from "../components/charts";
import { BarList, ChannelCarousel, RankedRows } from "../components/lists";
import { Avatar, Carousel, MetricToggle, QueryState, Section, StatTile, WatchTimeInfo } from "../components/ui";
import { clockTime, compact, date, duration, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { accent, axisLabel, grid, sub, surface } from "../theme";

interface SubsetTotals {
  videos: number; unique_videos: number; est_s: number;
  first_watched: string | null; last_watched: string | null; active_days: number;
}
interface SubsetBase {
  range: { label: string };
  in_range: SubsetTotals;
  all_time: SubsetTotals;
  top_videos: RankedItem[];
  monthly: MonthPoint[];
  clock: HourPoint[];
}

function Hero({ image, title, lines, action }: { image: ReactNode; title: ReactNode; lines: ReactNode[]; action?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-[#3a0a12] via-card to-card p-5 sm:p-8">
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        {image}
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-black tracking-tight sm:text-4xl">{title}</h1>
          {lines.filter(Boolean).map((l, i) => <p key={i} className="mt-1 text-sm text-sub">{l}</p>)}
        </div>
        {action}
      </div>
    </div>
  );
}

function YouTubeButton({ href, label = "Open on YouTube" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
       className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-bold text-bg hover:bg-white">
      <ExternalLink size={15} /> {label}
    </a>
  );
}

function SubsetTiles({ d }: { d: SubsetBase }) {
  const { filters } = useFilters();
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <StatTile label={tr(`Videos (${rangeLabel(filters)})`)} value={num(d.in_range.videos)}
                hint={filters.range === "all" ? undefined : tr(`${num(d.all_time.videos)} all time`)} />
      <StatTile label="Est. watch time" value={duration(d.in_range.est_s)} info={<WatchTimeInfo />}
                hint={filters.range === "all" ? undefined : `${duration(d.all_time.est_s)} all time`} />
      <StatTile label="First watched" value={<span className="text-xl sm:text-2xl">{date(d.all_time.first_watched)}</span>} />
      <StatTile label="Last watched" value={<span className="text-xl sm:text-2xl">{date(d.all_time.last_watched)}</span>} />
    </div>
  );
}

function SubsetCharts({ d, what }: { d: SubsetBase; what: string }) {
  const [measure, setMeasure] = useMeasure();
  const { filters } = useFilters();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Section title="Over time" subtitle={`All time, ${what}`} className="lg:col-span-3"
               action={<MeasureToggle value={measure} onChange={setMeasure} />}>
        {d.monthly.length ? <MonthlyBars data={fillMonths(d.monthly)} measure={measure} /> : <p className="text-sm text-muted">No watches.</p>}
      </Section>
      <Section title="When you watch them" subtitle={rangeLabel(filters)} className="lg:col-span-2">
        {d.clock.some((h) => h.count) ? <WatchClock data={d.clock} measure={measure} height={260} /> : <p className="text-sm text-muted">Nothing in this period.</p>}
      </Section>
    </div>
  );
}

/** Monthly series from the API skip empty months; fill them so gaps show as gaps. */
function fillMonths(data: MonthPoint[]): MonthPoint[] {
  if (!data.length) return data;
  const got = new Map(data.map((m) => [m.month, m]));
  const out: MonthPoint[] = [];
  let [y, m] = data[0].month.split("-").map(Number);
  const [ey, em] = data[data.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(got.get(key) ?? { month: key, count: 0, time_s: 0 });
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

// ------------------------------------------------------------------ channel

interface ChannelDetail extends SubsetBase {
  channel: { channel_id: string; title: string | null; handle?: string | null; avatar_url?: string | null;
             subscriber_count?: number | null; video_count?: number | null; country?: string | null;
             created_at?: string | null; topics: string[] };
  url: string;
  rank_history: { year: number; rank: number; count: number; channels_that_year: number }[];
}

export function ChannelPage() {
  const pinfo = usePlatform();
  const platformName = pinfo?.name ?? "YouTube";
  const isYouTube = (pinfo?.id ?? "youtube") === "youtube";
  const { id = "" } = useParams();
  const { filters } = useFilters();
  const d = useStats<ChannelDetail>(`channel/${encodeURIComponent(id)}`);
  return (
    <QueryState q={d} minHeight={500}>
      {(c) => (
        <div className="flex flex-col gap-4">
          <Hero
            image={<Avatar src={c.channel.avatar_url} name={c.channel.title} size={128} className="ring-4 ring-bg" />}
            title={c.channel.title ?? tr("Unknown channel")}
            lines={[
              [c.channel.handle, c.channel.subscriber_count != null && `${compact(c.channel.subscriber_count)} subscribers`,
               c.channel.video_count != null && (isYouTube ? `${num(c.channel.video_count)} uploads` : `${num(c.channel.video_count)} episodes`)]
                .filter(Boolean).join(" · "),
              [c.channel.country, c.channel.created_at && (isYouTube ? `on YouTube since ${date(c.channel.created_at)}`
                                                                     : `first aired ${date(c.channel.created_at)}`)].filter(Boolean).join(" · "),
            ]}
            action={<YouTubeButton href={c.url} label={`Find on ${platformName}`} />}
          />
          <SubsetTiles d={c} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Section title={tr("Your top videos from them")} subtitle={rangeLabel(filters)} className="lg:col-span-3">
              {c.top_videos.length ? <RankedRows items={c.top_videos} kind="video" showShare /> : <p className="text-sm text-muted">Nothing in this period.</p>}
            </Section>
            <Section title={tr("Rank among your channels")} subtitle="Per year" className="lg:col-span-2">
              <RankHistory data={c.rank_history} />
            </Section>
          </div>
          <SubsetCharts d={c} what={tr("from this channel")} />
          {c.channel.topics.length > 0 && (
            <Section title="Genres">
              <Chips items={c.channel.topics} to={(t) => `/genre/${encodeURIComponent(t)}`} />
            </Section>
          )}
        </div>
      )}
    </QueryState>
  );
}

function RankHistory({ data }: { data: ChannelDetail["rank_history"] }) {
  if (!data.length) return <p className="text-sm text-muted">No history.</p>;
  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: data.map((d) => String(d.year)), axisLabel, axisLine: { show: false }, axisTick: { show: false } },
    // log scale: rank #3 vs #12 matters as much as #300 vs #1,200
    yAxis: { type: "log", logBase: 10, inverse: true, min: 1, axisLabel: { ...axisLabel, formatter: (v: number) => `#${num(v)}` }, splitLine: { lineStyle: { color: grid } } },
    tooltip: {
      trigger: "axis",
      formatter: (ps: unknown) => {
        const p = (ps as { dataIndex: number }[])[0];
        const d = data[p.dataIndex];
        return `<b>#${num(d.rank)}</b> of ${num(d.channels_that_year)} channels<br/><span style="color:${sub}">${d.year} · ${num(d.count)} videos</span>`;
      },
    },
    series: [{ type: "line", data: data.map((d) => d.rank), lineStyle: { color: accent, width: 2 }, itemStyle: { color: accent, borderColor: surface, borderWidth: 2 }, symbolSize: 9 }],
  };
  return <Chart option={option} height={260} ariaLabel={tr("Channel rank per year")} />;
}

function Chips({ items, to }: { items: string[]; to?: (s: string) => string }) {
  const q = useLinkQuery();
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => to
        ? <Link key={t} to={to(t) + q} className="chip">{t}</Link>
        : <span key={t} className="chip cursor-default hover:bg-raised">{t}</span>)}
    </div>
  );
}

// ------------------------------------------------------------------ video

interface VideoDetail {
  video: {
    video_id: string; status: string; title: string | null; channel_id: string | null; channel_title: string | null;
    published_at?: string | null; duration_s?: number | null; category?: string | null; category_id?: string | null;
    tags: string[]; topics: string[]; thumb_large?: string | null; view_count?: number | null; like_count?: number | null;
    bucket?: string; is_background?: number; is_live?: number;
  };
  url: string;
  watch_count: number;
  total_est_s: number;
  watches: { entry_id: number; local_iso: string; est_s: number; est_method: string; delayed_fix: number }[];
}

export function VideoPage() {
  const pinfo = usePlatform();
  const platformName = pinfo?.name ?? "YouTube";
  const isYouTubeVideo = (pinfo?.id ?? "youtube") === "youtube";
  const hasTimes = useCapability("time_of_day");
  const { id = "" } = useParams();
  const d = useStats<VideoDetail>(`video/${encodeURIComponent(id)}`);
  const q = useLinkQuery();
  return (
    <QueryState q={d} minHeight={500}>
      {(v) => {
        const unavailable = v.video.status !== "ok";
        const isShort = v.video.bucket === "short";
        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <div className={`overflow-hidden rounded-card bg-raised ${isShort ? "mx-auto aspect-[9/16] max-h-[560px]" : "aspect-video"}`}>
                  {!unavailable && (
                    <img src={v.video.thumb_large ?? (isYouTubeVideo ? `https://i.ytimg.com/vi/${v.video.video_id}/hqdefault.jpg` : "")} alt=""
                         referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  )}
                  {unavailable && <div className="flex h-full items-center justify-center p-6 text-center text-sub">{isYouTubeVideo ? <>This video was removed or made private.<br />Takeout still remembers you watched it.</> : "No picture for this title."}</div>}
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:col-span-2">
                <h1 className="text-xl font-bold leading-snug sm:text-2xl">{v.video.title && !v.video.title.startsWith("http") ? v.video.title : tr("Unavailable video")}</h1>
                {v.video.channel_id && (
                  <Link to={`/channel/${v.video.channel_id}${q}`} className="text-sm font-medium text-sub hover:text-ink">
                    {v.video.channel_title ?? tr("Channel")} ›
                  </Link>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {isShort && <span className="rounded bg-raised px-2 py-1">Short (approx.)</span>}
                  {v.video.is_live ? <span className="rounded bg-raised px-2 py-1">Live stream</span> : null}
                  {v.video.is_background ? <span className="rounded bg-raised px-2 py-1">Background audio</span> : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="You watched it" value={`${num(v.watch_count)}×`} />
                  <StatTile label="Est. time" value={duration(v.total_est_s)} info={<WatchTimeInfo />} />
                  <StatTile label="Length" value={v.video.duration_s ? duration(v.video.duration_s) : "–"} />
                  <StatTile label={isYouTubeVideo ? "Uploaded" : "First aired"} value={<span className="text-lg">{date(v.video.published_at)}</span>} />
                </div>
                <div className="text-sm text-sub">
                  {[v.video.category, v.video.view_count != null && tr(`${compact(v.video.view_count)} views`),
                    v.video.like_count != null && tr(`${compact(v.video.like_count)} likes`)].filter(Boolean).join(" · ")}
                </div>
                <div><YouTubeButton href={v.url} label={`Find on ${platformName}`} /></div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Every time you watched it" subtitle={`${num(v.watch_count)} ${v.watch_count === 1 ? "time" : "times"}`}>
                <ol className="flex flex-col divide-y divide-line">
                  {[...v.watches].reverse().map((w) => (
                    <li key={w.entry_id} className="flex items-center justify-between py-2 text-sm">
                      <span>{date(w.local_iso)}{hasTimes && <span className="text-sub"> · {clockTime(w.local_iso)}</span>}</span>
                      <span className="text-xs text-sub">~{duration(w.est_s)}{w.delayed_fix ? " · start fixed" : ""}</span>
                    </li>
                  ))}
                </ol>
              </Section>
              <div className="flex flex-col gap-4">
                {v.video.topics.length > 0 && <Section title="Genres"><Chips items={v.video.topics} to={(t) => `/genre/${encodeURIComponent(t)}`} /></Section>}
                {v.video.tags.length > 0 && <Section title="Tags"><Chips items={v.video.tags.slice(0, 40)} /></Section>}
              </div>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

// ------------------------------------------------------------------ category & genre

interface GroupDetail extends SubsetBase { top_channels: RankedItem[] }

function GroupPage({ title, kicker, d, external }: { title: string; kicker: string; d: GroupDetail; external?: string }) {
  const { filters, update } = useFilters();
  return (
    <div className="flex flex-col gap-4">
      <Hero
        image={<div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-yt text-4xl font-black text-white">{title.charAt(0)}</div>}
        title={title}
        lines={[kicker, tr(`${num(d.all_time.videos)} videos all time · ${num(d.all_time.unique_videos)} different`)]}
        action={external && <YouTubeButton href={external} label="About on Wikipedia" />}
      />
      <SubsetTiles d={d} />
      <Section title={tr("Top channels")} subtitle={rangeLabel(filters)} action={<MetricToggle value={filters.metric} onChange={(m) => update({ metric: m })} />}>
        {d.top_channels.length ? <ChannelCarousel items={d.top_channels} /> : <p className="text-sm text-muted">Nothing in this period.</p>}
      </Section>
      <Section title={tr("Top videos")} subtitle={rangeLabel(filters)}>
        {d.top_videos.length ? <RankedRows items={d.top_videos.slice(0, 10)} kind="video" showShare /> : <p className="text-sm text-muted">Nothing in this period.</p>}
      </Section>
      <SubsetCharts d={d} what={`in ${title}`} />
    </div>
  );
}

export function CategoryPage() {
  const { id = "" } = useParams();
  const d = useStats<GroupDetail & { category: { title: string } }>(`category/${encodeURIComponent(id)}`);
  return <QueryState q={d} minHeight={500}>{(c) => <GroupPage title={c.category.title} kicker="YouTube category" d={c} />}</QueryState>;
}

export function GenrePage() {
  const { topic = "" } = useParams();
  const d = useStats<GroupDetail & { genre: { title: string; url: string } }>(`genre/${encodeURIComponent(topic)}`);
  const isYouTube = (usePlatform()?.id ?? "youtube") === "youtube";
  return <QueryState q={d} minHeight={500}>{(g) => <GroupPage title={g.genre.title} kicker={isYouTube ? "Genre (YouTube topic)" : "Genre"} d={g}
                                                                external={isYouTube ? g.genre.url : undefined} />}</QueryState>;
}

// ------------------------------------------------------------------ year

interface YearDetail {
  year: number;
  overview: Overview;
  top_channels: RankedItem[];
  top_videos: RankedItem[];
  top_categories: RankedItem[];
  top_genres: RankedItem[];
  new_discoveries: { channel_id: string; title?: string; avatar_url?: string | null; count: number; first_watched: string }[];
  monthly: MonthPoint[];
  clock: HourPoint[];
}

export function YearPage() {
  const { year = "" } = useParams();
  const platformName = usePlatform()?.name ?? "YouTube";
  const hasCategories = useCapability("categories");
  const useHasSeriesUnit = useHasSeries() ? "episodes" : tr("videos");
  const { filters } = useFilters();
  const d = useStats<YearDetail>(`year/${year}`);
  const [measure, setMeasure] = useMeasure();
  const q = useLinkQuery();
  return (
    <QueryState q={d} minHeight={500}>
      {(y) => (
        <div className="flex flex-col gap-4">
          <Hero
            image={<div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-yt to-[#7a0019] text-2xl font-black">{y.year}</div>}
            title={`Your ${y.year} on ${platformName}`}
            lines={[tr(`${num(y.overview.videos)} videos · ${duration(y.overview.est_s)} estimated · ${num(y.overview.unique_channels)} channels`)]}
            action={<Link to={`/wrapped?year=${y.year}`} className="flex shrink-0 items-center gap-1.5 rounded-full bg-yt px-4 py-2 text-sm font-bold text-white hover:bg-yt-dark"><Sparkles size={15} /> Play {y.year} Wrapped</Link>}
          />
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <StatTile label={tr("Videos")} value={compact(y.overview.videos)} delta={y.overview.change.videos} />
            <StatTile label="Est. watch time" value={duration(y.overview.est_s)} delta={y.overview.change.est_s} info={<WatchTimeInfo />} />
            <StatTile label={tr("Channels")} value={compact(y.overview.unique_channels)} delta={y.overview.change.unique_channels} />
            <StatTile label="Days you watched" value={pct(y.overview.pct_days_active)} hint={`${num(y.overview.active_days)} days`} />
          </div>
          <Section title={tr("Top channels")} subtitle={tr(`${y.year}, by ${filters.metric === "time" ? "watch time" : tr("videos")}`)}>
            <ChannelCarousel items={y.top_channels} />
          </Section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title={tr("Top videos")}><RankedRows items={y.top_videos} kind="video" /></Section>
            <div className="flex flex-col gap-4">
              <Section title="Top genres"><BarList items={y.top_genres.slice(0, 6)} metric={filters.metric} linkTo={(g) => `/genre/${encodeURIComponent(g.key)}`} /></Section>
              {hasCategories && <Section title="Top categories"><BarList items={y.top_categories.slice(0, 6)} metric={filters.metric} linkTo={(c) => `/category/${c.key}`} /></Section>}
            </div>
          </div>
          <Section title="New discoveries" subtitle={tr(`Channels you found in ${y.year}`)}>
            <Carousel>
              {y.new_discoveries.map((c) => (
                <Link key={c.channel_id} to={`/channel/${c.channel_id}${q}`} className="flex w-[96px] shrink-0 flex-col items-center text-center">
                  <Avatar src={c.avatar_url} name={c.title} size={80} />
                  <div className="mt-2 line-clamp-1 w-full text-sm font-medium">{c.title}</div>
                  <div className="text-xs text-sub">{num(c.count)} {useHasSeriesUnit}</div>
                </Link>
              ))}
            </Carousel>
          </Section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Section title="Month by month" className="lg:col-span-3" action={<MeasureToggle value={measure} onChange={setMeasure} />}>
              <MonthlyBars data={y.monthly} measure={measure} />
            </Section>
            <Section title="Watch clock" className="lg:col-span-2"><WatchClock data={y.clock} measure={measure} height={260} /></Section>
          </div>
        </div>
      )}
    </QueryState>
  );
}
