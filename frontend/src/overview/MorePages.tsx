/* The "More" pages in the new look: ads you saw and your search history. Kept plain on purpose: people come here
   because they went looking. Same parts as every page: header, a row of numbers, then cards. */
import { ReactNode } from "react";
import { useMeta, useStats } from "../api";
import { useFilters } from "../filters";
import { clockTime, date, num, pct } from "../format";
import { OV, PageBody, PageHeader, Skeleton, StatsFrame, kicker } from "./kit";
import { periodTitle } from "./takeaways";

function Numbers({ items }: { items: [string, ReactNode, ReactNode?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([l, v, hint]) => (
        <div key={l} className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3" style={{ background: OV.paper, borderColor: OV.ink }}>
          <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: OV.soft }}>{l}</dt>
          <dd className="m-0 break-words font-ov-display text-[24px] font-extrabold leading-tight">{v}</dd>
          {hint && <dd className="m-0 text-[12px]" style={{ color: OV.soft }}>{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Card({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6" style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        {title && <h2 className="font-ov-display text-[24px] font-extrabold leading-tight">{title}</h2>}
      </div>
      {children}
    </section>
  );
}

function BarRows({ rows }: { rows: { label: string; value: number; note: string }[] }) {
  if (!rows.length) return <p style={{ color: OV.soft }}>Nothing in this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => (
        <li key={r.label} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "#E0D5C1" }}>
          <span className="w-5 text-right font-ov-display text-[14px] font-extrabold">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{r.label}</span>
          <span className="hidden h-2.5 w-[30%] overflow-hidden rounded-full sm:block" style={{ background: OV.sand }}>
            <span className="block h-full" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: OV.ink }} />
          </span>
          <span className="w-[110px] text-right font-shelf-mono text-[12px]">{r.note}</span>
        </li>
      ))}
    </ol>
  );
}

function Bars({ data, label }: { data: { key: string; label: string; value: number }[]; label: string }) {
  if (!data.length) return <p style={{ color: OV.soft }}>Nothing yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const many = data.length > 24;
  return (
    <>
      <div className="grid h-[160px] items-end gap-[2px]" style={{ gridTemplateColumns: `repeat(${data.length},minmax(0,1fr))` }} role="img" aria-label={label}>
        {data.map((d) => <span key={d.key} title={`${d.label}: ${num(d.value)}`} className="rounded-t-[2px]" style={{ height: `${Math.max(1, (d.value / max) * 100)}%`, background: OV.ink }} />)}
      </div>
      <div aria-hidden className="grid font-shelf-mono text-[10px]" style={{ gridTemplateColumns: `repeat(${data.length},minmax(0,1fr))`, color: OV.soft }}>
        {data.map((d) => <span key={d.key} className="overflow-visible whitespace-nowrap">{many ? (d.key.endsWith("-01") ? d.key.slice(0, 4) : "") : d.label}</span>)}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ ads

interface AdsResponse {
  ads: number; homepage_impressions: number; clicks: number; prerolls_linked: number;
  ads_per_watch_hour: number | null; brand_identified_pct: number | null;
  most_repeated: { video_id: string; count: number; title: string | null; brand: string | null; thumb: string | null; first: string; last: string }[];
  top_brands: { brand: string; count: number; distinct_ads: number }[];
  busiest_day: { date: string; count: number } | null;
  recent_clicks: { local_iso: string; title: string | null; brand: string | null }[];
  by_year: { year: number; count: number }[];
}

export function AdsPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const ads = useStats<AdsResponse>("ads", { limit: 15 });
  const a = ads.data;
  return (
    <StatsFrame>
      <PageHeader label={`Ads you saw · ${periodTitle(filters, meta?.today)}`} title={a ? `${num(a.ads)} ads sat through.` : "Ads you saw"}>
        <p className="text-[15px]" style={{ color: OV.mute }}>Everything your history marked as an ad. Not counted anywhere else in your stats.</p>
      </PageHeader>
      <PageBody>
        {!a ? <Skeleton h={400} /> : (
          <>
            <Numbers items={[
              ["Video ads", num(a.ads), `${num(a.prerolls_linked)} right before a video`],
              ["Ads per hour watched", a.ads_per_watch_hour == null ? "–" : a.ads_per_watch_hour.toFixed(1)],
              ["Ads you clicked", num(a.clicks), `${num(a.homepage_impressions)} homepage ads seen`],
              ["Busiest ad day", a.busiest_day ? num(a.busiest_day.count) : "–", a.busiest_day ? date(a.busiest_day.date) : undefined],
            ]} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="The same ad, again and again" title="Most repeated ads">
                {!a.most_repeated.length ? <p style={{ color: OV.soft }}>No ads in this period.</p> : (
                  <ol className="flex flex-col">
                    {a.most_repeated.map((ad, i) => {
                      const thumb = ad.thumb ?? `https://i.ytimg.com/vi/${ad.video_id}/mqdefault.jpg`;
                      return (
                        <li key={ad.video_id} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "#E0D5C1" }}>
                          <span className="w-5 text-right font-ov-display text-[14px] font-extrabold">{i + 1}</span>
                          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-[88px] shrink-0 rounded border object-cover" style={{ borderColor: OV.ink }} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="line-clamp-2 text-[14px] font-bold leading-snug">{ad.title && !ad.title.startsWith("http") ? ad.title : "Untitled ad"}</span>
                            <span className="truncate text-[12px]" style={{ color: OV.soft }}>{ad.brand ?? "Unknown advertiser"} · {date(ad.first)} to {date(ad.last)}</span>
                          </span>
                          <span className="font-ov-display text-[16px] font-extrabold">{ad.count}×</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>
              <Card label={`Top advertisers${a.brand_identified_pct != null ? ` · known for ${pct(a.brand_identified_pct)} of ads` : ""}`} title="Who showed you the most">
                <BarRows rows={a.top_brands.map((b) => ({ label: b.brand, value: b.count, note: `${num(b.count)} ads · ${num(b.distinct_ads)} different` }))} />
              </Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="Ads per year"><Bars data={a.by_year.map((y) => ({ key: String(y.year), label: String(y.year), value: y.count }))} label="Ads per year" /></Card>
              <Card label="Ads you clicked · most recent first">
                {!a.recent_clicks.length ? <p style={{ color: OV.soft }}>You didn't click any ads in this period.</p> : (
                  <ul className="flex flex-col">
                    {a.recent_clicks.map((c, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b py-2 text-[14px]" style={{ borderColor: "#E0D5C1" }}>
                        <span className="truncate">{c.brand ?? c.title ?? "Unknown"}</span>
                        <span className="shrink-0 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{date(c.local_iso)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ search

interface SearchStats {
  available: boolean; searches: number; unique: number;
  top_searches: { query: string; count: number }[];
  top_terms: { term: string; count: number }[];
  per_month: { month: string; count: number }[];
  first_in_range: { query: string; local_iso: string } | null;
  first_ever: { query: string; local_iso: string };
}

export function SearchPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const s = useStats<SearchStats>("search", { limit: 30 });
  const d = s.data;
  const top = d?.top_searches[0];
  return (
    <StatsFrame>
      <PageHeader label={`Search history · ${periodTitle(filters, meta?.today)}`}
                  title={!d ? "Search history" : !d.available ? "No search history yet" : top ? `“${top.query}”, ${num(top.count)} times.` : `${num(d.searches)} searches.`}>
        {d?.available && top && <p className="text-[15px]" style={{ color: OV.mute }}>Your most repeated search. {num(d.searches)} searches in all, {num(d.unique)} different.</p>}
      </PageHeader>
      <PageBody>
        {!d ? <Skeleton h={400} /> : !d.available ? (
          <Card label="How to add it">
            <p className="text-[15px]">Search history comes from your YouTube Takeout (<code>search-history.json</code>). Add it on the Data sources page and it shows up here.</p>
          </Card>
        ) : (
          <>
            <Numbers items={[
              ["Searches", num(d.searches)], ["Different searches", num(d.unique)],
              ["Your first search ever", `“${d.first_ever.query}”`, `${date(d.first_ever.local_iso)} · ${clockTime(d.first_ever.local_iso)}`],
              ["First in this period", d.first_in_range ? `“${d.first_in_range.query}”` : "–", d.first_in_range ? date(d.first_in_range.local_iso) : undefined],
            ]} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="Exact searches, most repeated" title="Top searches">
                <BarRows rows={d.top_searches.map((t) => ({ label: t.query, value: t.count, note: `${num(t.count)}×` }))} />
              </Card>
              <div className="flex flex-col gap-4">
                <Card label="Single words across all your searches" title="Most-searched words">
                  <div className="flex flex-wrap gap-2">
                    {d.top_terms.map((t, i) => (
                      <span key={t.term} className="rounded-full border-2 px-3 py-1" style={{ borderColor: i < 3 ? OV.ink : "#CDBFA6", fontSize: Math.max(12, 20 - i * 0.3), background: i === 0 ? OV.mustard : "transparent" }}>
                        {t.term} <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{num(t.count)}</span>
                      </span>
                    ))}
                  </div>
                </Card>
                <Card label="Searches per month">
                  <Bars data={d.per_month.map((m) => ({ key: m.month, label: new Date(m.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" }), value: m.count }))} label="Searches per month" />
                </Card>
              </div>
            </div>
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}
