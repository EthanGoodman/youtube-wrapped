import { useState } from "react";
import { Link } from "react-router-dom";
import { HourPoint, Overview, TopResponse, WatchInfo, useMeta, useStats } from "../api";
import { BarList, ChannelCarousel, RankedRows, WatchRows } from "../components/lists";
import { MeasureToggle, WatchClock, useMeasure } from "../components/charts";
import { MetricToggle, QueryState, Section, SeeAll, StatTile, WatchTimeInfo } from "../components/ui";
import { bigDuration, compact, date, duration, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { categorical } from "../theme";

export function Home() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const ov = useStats<Overview>("overview");
  const channels = useStats<TopResponse>("top/channels", { limit: 15 });
  const videos = useStats<TopResponse>("top/videos", { limit: 5 });
  const genres = useStats<TopResponse>("top/genres", { limit: 8 });
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const [measure, setMeasure] = useMeasure();
  const period = rangeLabel(filters);
  const q = useLinkQuery();

  return (
    <div className="flex flex-col gap-4">
      {/* profile header */}
      <div className="flex items-center gap-4 px-1 pt-1">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-yt to-[#7a0019] sm:h-20 sm:w-20">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden><path d="M9 7v10l8-5z" fill="#fff" /></svg>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Your YouTube</h1>
          <p className="text-sm text-sub">
            {meta ? <>Watching since {date(meta.first_date)} · {num(meta.watches)} videos logged</> : " "}
          </p>
        </div>
      </div>

      <Section title="Overview" subtitle={`Your watching from ${period}`}>
        <QueryState q={ov} minHeight={180}>
          {(o) => <OverviewTiles o={o} />}
        </QueryState>
      </Section>

      <Section title="Top channels" subtitle={`Your top channels from ${period}`}
               action={<><MetricToggle value={filters.metric} onChange={(m) => update({ metric: m })} /><SeeAll to="/top/channels" /></>}>
        <QueryState q={channels} minHeight={150} empty={(d) => !d.items.length}>
          {(d) => <ChannelCarousel items={d.items} />}
        </QueryState>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Top videos" subtitle={`Your most rewatched videos from ${period}`} action={<SeeAll to="/top/videos" />}>
          <QueryState q={videos} minHeight={300} empty={(d) => !d.items.length}>
            {(d) => <RankedRows items={d.items} kind="video" />}
          </QueryState>
        </Section>
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
  const t = bigDuration(o.est_s);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatTile label="Videos watched" value={compact(o.videos)} delta={o.change.videos}
                  hint={`${num(o.avg_videos_per_day)} a day · ${num(o.unique_videos)} unique`} />
        <StatTile label="Est. watch time" value={t.value} unit={t.unit} delta={o.change.est_s} info={<WatchTimeInfo />}
                  hint={`max possible ${duration(o.max_s)} · ${duration(o.avg_est_s_per_day)}/day`} />
        <StatTile label="Channels" value={compact(o.unique_channels)} delta={o.change.unique_channels} />
        <StatTile label="Days you watched" value={pct(o.pct_days_active)}
                  delta={o.change.active_days} hint={`${num(o.active_days)} of ${num(o.days)} days`} />
      </div>
      <SplitBar o={o} />
    </>
  );
}

/** Long-form / Shorts / Music: one whole split into parts (tall segmented bar + legend). */
function SplitBar({ o }: { o: Overview }) {
  const parts = [
    { key: "long", label: "Long-form", color: categorical[0], ...o.split.long },
    { key: "short", label: "Shorts (approx.)", color: categorical[1], ...o.split.short },
    { key: "music", label: "Music", color: categorical[2], ...o.split.music },
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
                 title={`${p.label}: ${num(p.videos)} videos, ${duration(p.est_s)} est.`}>
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
    <Section title="Recent watches" subtitle="The latest videos in your history">
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
