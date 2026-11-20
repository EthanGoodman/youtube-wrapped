import type { EChartsOption } from "echarts";
import { useStats } from "../api";
import { Chart } from "../components/Chart";
import { PageTitle, QueryState, Section, StatTile, Thumb } from "../components/ui";
import { date, num, pct } from "../format";
import { rangeLabel, useFilters } from "../filters";
import { accent, axis, axisLabel, grid, sub } from "../theme";

interface AdsResponse {
  ads: number;
  homepage_impressions: number;
  clicks: number;
  prerolls_linked: number;
  ads_per_watch_hour: number | null;
  brand_identified_pct: number | null;
  most_repeated: { video_id: string; count: number; title: string | null; brand: string | null; thumb: string | null; first: string; last: string }[];
  top_brands: { brand: string; count: number; distinct_ads: number }[];
  busiest_day: { date: string; count: number } | null;
  recent_clicks: { local_iso: string; title: string | null; brand: string | null }[];
  by_year: { year: number; count: number }[];
}

export function Ads() {
  const { filters } = useFilters();
  const ads = useStats<AdsResponse>("ads", { limit: 15 });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Ads you sat through" subtitle={`Everything Takeout marked “From Google Ads”, from ${rangeLabel(filters)}. Not counted anywhere else.`} />
      <QueryState q={ads} minHeight={400}>
        {(a) => (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatTile label="Video ads" value={num(a.ads)} hint={`${num(a.prerolls_linked)} right before a video`} />
              <StatTile label="Ads per hour watched" value={a.ads_per_watch_hour == null ? "–" : a.ads_per_watch_hour.toFixed(1)}
                        hint="per estimated hour" />
              <StatTile label="Ads you clicked" value={num(a.clicks)} hint={`${num(a.homepage_impressions)} homepage ads seen`} />
              <StatTile label="Busiest ad day" value={a.busiest_day ? num(a.busiest_day.count) : "–"}
                        hint={a.busiest_day ? date(a.busiest_day.date) : undefined} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Most repeated ads" subtitle="The same ad, again and again">
                {a.most_repeated.length ? (
                  <ol className="flex flex-col">
                    {a.most_repeated.map((ad, i) => (
                      <li key={ad.video_id} className="flex items-center gap-3 py-2">
                        <span className="w-6 text-center font-black text-sub">{i + 1}</span>
                        <Thumb src={ad.thumb} videoId={ad.video_id} width={96} />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-medium">{ad.title && !ad.title.startsWith("http") ? ad.title : "Untitled ad"}</div>
                          <div className="truncate text-xs text-sub">{ad.brand ?? "Unknown advertiser"} · {date(ad.first)} – {date(ad.last)}</div>
                        </div>
                        <span className="text-sm font-bold tabular">{ad.count}×</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted">No ads in this period.</p>}
              </Section>

              <Section title="Top advertisers"
                       subtitle={`Ad videos grouped by the channel that posted them${a.brand_identified_pct != null ? ` (known for ${pct(a.brand_identified_pct)} of ads)` : ""}`}>
                <BrandBars brands={a.top_brands} />
              </Section>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Ads per year">
                <YearBars data={a.by_year} />
              </Section>
              <Section title="Ads you clicked" subtitle="Most recent first">
                {a.recent_clicks.length ? (
                  <ul className="flex flex-col divide-y divide-line">
                    {a.recent_clicks.map((c, i) => (
                      <li key={i} className="py-2">
                        <div className="truncate text-sm">{c.brand ?? c.title ?? "Unknown"}</div>
                        <div className="text-xs text-sub">{date(c.local_iso)}</div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">You didn't click any ads in this period.</p>}
              </Section>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function BrandBars({ brands }: { brands: AdsResponse["top_brands"] }) {
  if (!brands.length) return <p className="text-sm text-muted">No ads in this period.</p>;
  const max = Math.max(...brands.map((b) => b.count));
  return (
    <ol className="flex flex-col gap-1.5">
      {brands.map((b, i) => (
        <li key={b.brand} className="relative flex h-9 items-center overflow-hidden rounded-lg">
          <div className="absolute inset-y-0 left-0 rounded-lg bg-yt-soft/25" style={{ width: `${Math.max(3, (b.count / max) * 100)}%` }} />
          <span className="relative w-8 text-center text-sm font-black text-sub">{i + 1}</span>
          <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{b.brand}</span>
          <span className="relative px-3 text-xs text-sub tabular">{num(b.count)} ads · {num(b.distinct_ads)} different</span>
        </li>
      ))}
    </ol>
  );
}

function YearBars({ data }: { data: { year: number; count: number }[] }) {
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: data.map((d) => String(d.year)), axisLabel, axisLine: { lineStyle: { color: axis } }, axisTick: { show: false } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: grid } }, axisLabel },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const { name, value } = p as { name: string; value: number };
        return `<b>${num(value)} ads</b><br/><span style="color:${sub}">${name}</span>`;
      },
    },
    series: [{ type: "bar", data: data.map((d) => d.count), barMaxWidth: 24, itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] } }],
  };
  return <Chart option={option} height={240} ariaLabel="Ads per year" />;
}
