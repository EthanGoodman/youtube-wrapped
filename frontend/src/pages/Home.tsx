import { Smile } from "lucide-react";
import { useState } from "react";
import { Link, useVocab, tr, useCapability, useHasSeries, usePlatform } from "../platform";
import { NetflixHome } from "./NetflixHome";
import { KindSplit, KindSplitBar, ShowProgress, ShowProgressRows, useShows } from "../components/shows";
import { HourPoint, Overview, TopResponse, WatchInfo, useMeta, useStats } from "../api";
import { BarList, ChannelCarousel, RankedRows, WatchRows } from "../components/lists";
import { MeasureToggle, WatchClock, useMeasure } from "../components/charts";
import { MetricToggle, QueryState, Section, SeeAll, StatTile, WatchTimeInfo } from "../components/ui";
import { bigDuration, compact, date, duration, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { categorical, otherColor } from "../theme";

export function Home() {
  // platforms with shows (Netflix) get their own home screen
  const platform = usePlatform();
  const series = useHasSeries();
  if (!platform) return null;  // wait for the platform, so Netflix doesn't flash the stats layout first
  return series ? <NetflixHome /> : <StatsHome />;
}

function StatsHome() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const ov = useStats<Overview>("overview");
  const channels = useStats<TopResponse>("top/channels", { limit: 15 });
  const hasSeries = useHasSeries();
  const videos = useStats<TopResponse>("top/videos", { limit: 5 }, { enabled: !hasSeries });
  const genres = useStats<TopResponse>("top/genres", { limit: 8 });
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const [measure, setMeasure] = useMeasure();
  const period = rangeLabel(filters);
  const { v } = useVocab();
  const q = useLinkQuery();

  return (
    <div className="flex flex-col gap-4">
      {/* profile header */}
      <div className="flex items-center gap-4 px-1 pt-1">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center sm:h-20 sm:w-20 ${meta && meta.platform.id !== "youtube"
                ? "rounded-[4px] bg-gradient-to-br from-[#2c6cdb] to-[#1b3f9c]" : "rounded-full bg-gradient-to-br from-yt to-black/60"}`}>
          {meta?.platform.id === "youtube" || !meta
            ? <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden><path d="M9 7v10l8-5z" fill="#fff" /></svg>
            : <Smile size={36} strokeWidth={2.5} aria-hidden />}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">Your {meta?.platform.name ?? "YouTube"}</h1>
          <p className="text-sm text-sub">
            {meta ? <>Watching since {date(meta.first_date)} · {num(meta.watches)} {tr("videos")} logged
              {meta.by_bucket.short ? <> ({num(meta.by_bucket.short)} Shorts, {num(meta.by_bucket.long ?? 0)} long-form
                {meta.by_bucket.music ? `, ${num(meta.by_bucket.music)} songs` : ""}
                {meta.by_bucket.unknown ? `, ${num(meta.by_bucket.unknown)} removed` : ""})</> : null}</> : " "}
          </p>
        </div>
      </div>

      <Section title="Overview" subtitle={`Your watching from ${period}`}>
        <QueryState q={ov} minHeight={180}>
          {(o) => <OverviewTiles o={o} />}
        </QueryState>
      </Section>

      <Section title={`Top ${v.creators}`} subtitle={`Your top ${v.creators} from ${period}`}
               action={<><MetricToggle value={filters.metric} onChange={(m) => update({ metric: m })} /><SeeAll to="/top/channels" /></>}>
        <QueryState q={channels} minHeight={150} empty={(d) => !d.items.length}>
          {(d) => <ChannelCarousel items={d.items} />}
        </QueryState>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {hasSeries ? <ShowsCard /> : (
          <Section title={`Top ${v.items}`} subtitle={`Your most rewatched ${v.items} from ${period}`} action={<SeeAll to="/top/videos" />}>
            <QueryState q={videos} minHeight={300} empty={(d) => !d.items.length}>
              {(d) => <RankedRows items={d.items} kind="video" />}
            </QueryState>
          </Section>
        )}
        <Section title="Top genres" subtitle={`Your top genres from ${period}`} action={<SeeAll to="/top/genres" />}>
          <QueryState q={genres} minHeight={300} empty={(d) => !d.items.length}>
            {(d) => <BarList items={d.items} metric={filters.metric} linkTo={(g) => `/genre/${encodeURIComponent(g.key)}`} />}
          </QueryState>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Watch clock" subtitle={`When you watch, from ${period}`}
                 action={<><MeasureToggle value={measure} onChange={setMeasure} /></>}>
          <QueryState q={clock} minHeight={300} empty={(d) => !d.data.some((h) => h.count)}>
            {(d) => <WatchClock data={d.data} measure={measure} />}
          </QueryState>
          <div className="mt-1 text-right"><Link to={"/patterns" + q} className="text-sm text-sub hover:text-ink">More patterns ›</Link></div>
        </Section>
        <RecentWatches />
      </div>
    </div>
  );
}

function OverviewTiles({ o }: { o: Overview }) {
  const hasShorts = useCapability("shorts");
  const hasTimes = useCapability("time_of_day");
  const hasSeries = useHasSeries();
  const { filters } = useFilters();
  const t = bigDuration(o.est_s);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatTile label={tr("Videos watched")} value={compact(o.videos)} delta={o.change.videos}
                  hint={`${num(o.avg_videos_per_day)} a day · ${num(o.unique_videos)} unique`} />
        <StatTile label="Est. watch time" value={t.value} unit={t.unit} delta={o.change.est_s} info={<WatchTimeInfo />}
                  hint={`${hasTimes ? `max possible ${duration(o.max_s)} · ` : ""}${duration(o.avg_est_s_per_day)}/day`} />
        <StatTile label={tr("Channels")} value={compact(o.unique_channels)} delta={o.change.unique_channels} />
        <StatTile label="Days you watched" value={pct(o.pct_days_active)}
                  delta={o.change.active_days} hint={`${num(o.active_days)} of ${num(o.days)} days`} />
      </div>
      {/* the long-form / Shorts split only means something when both are shown */}
      {hasShorts && filters.buckets.includes("long") && filters.buckets.includes("short") && <SplitBar o={o} />}
      {hasSeries && <EpisodeMovieSplit />}
    </>
  );
}

/** Long-form / Shorts / Music: one whole split into parts (tall segmented bar + legend). */
function SplitBar({ o }: { o: Overview }) {
  const parts = [
    { key: "long", label: "Long-form", color: categorical[0], ...o.split.long },
    { key: "short", label: "Shorts (approx.)", color: categorical[1], ...o.split.short },
    { key: "music", label: "Music", color: categorical[2], ...o.split.music },
    { key: "unknown", label: "Removed/private (type unknown)", color: otherColor, ...o.split.unknown },
  ].filter((p) => p.videos > 0);
  const total = parts.reduce((s, p) => s + p.videos, 0);
  if (!total) return null;
  return (
    <div className="mt-4">
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded" role="img"
           aria-label={parts.map((p) => `${p.label} ${pct(p.videos / total)}`).join(", ")}>
        {parts.map((p) => {
          const share = p.videos / total;
          return (
            <div key={p.key} className="flex h-full items-center rounded px-2 text-xs font-bold text-white"
                 style={{ width: `${share * 100}%`, background: p.color }}
                 title={tr(`${p.label}: ${num(p.videos)} videos, ${duration(p.est_s)} est.`)}>
              {share > 0.12 ? pct(share) : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} · {num(p.videos)} videos · {duration(p.est_s)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecentWatches() {
  const [n, setN] = useState(8);
  const recent = useStats<WatchInfo[]>("recent", { limit: n });
  return (
    <Section title="Recent watches" subtitle={tr("The latest videos in your history")}>
      <QueryState q={recent} minHeight={300} empty={(d) => !d.length}>
        {(d) => (
          <>
            <WatchRows items={d} />
            {n < 50 && (
              <button onClick={() => setN(50)} className="mt-2 w-full rounded-full bg-raised py-2 text-sm font-medium hover:bg-[#3f3f3f]">
                Show more
              </button>
            )}
          </>
        )}
      </QueryState>
    </Section>
  );
}

function EpisodeMovieSplit() {
  const split = useShows<KindSplit>("split");
  return split.data ? <KindSplitBar split={split.data.data} /> : null;
}

/** Netflix home: the shows you watched and how far you got. */
function ShowsCard() {
  const { filters } = useFilters();
  const progress = useShows<{ shows: ShowProgress[] }>("progress", { limit: 5 });
  return (
    <Section title="Your shows" subtitle={`How far you got, from ${rangeLabel(filters)}`} action={<SeeAll to="/shows" />}>
      <QueryState q={progress} minHeight={300} empty={(d) => !d.data.shows.length}>
        {(d) => <ShowProgressRows shows={d.data.shows} />}
      </QueryState>
    </Section>
  );
}
