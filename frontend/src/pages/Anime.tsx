/* The Anime tab (Crunchyroll): sub vs dub, simulcast, studios, the seasons your series aired in,
   decades and formats, AniList scores and tags. */
import { ReactNode } from "react";
import { Link } from "../platform";
import { QueryState, Section } from "../components/ui";
import { useShows } from "../components/shows";
import { Meta, ORANGE, PosterImg, TEAL, Tag, subDub } from "../components/cr";
import { month, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

interface Brief { key: string; title: string; poster: string | null; count: number }
interface Series extends Brief {
  time_s: number; dub_share: number | null; simulcast: number; studios: string[];
  anime_season: string | null; score: number | null; format: string | null;
}
interface AnimeData {
  series_count: number;
  sub_dub: { sub: number; dub: number; sub_time_s: number; dub_time_s: number };
  sub_dub_months: { month: string; sub: number; dub: number }[];
  series: Series[];
  simulcast: { episodes: number; dated: number; median_days: number | null; buckets: Record<string, number>; series: Series[] };
  studios: { name: string; count: number; time_s: number; series: Brief[] }[];
  seasons: { season: string; count: number; series: Brief[] }[];
  decades: { decade: string; count: number }[];
  formats: { format: string; count: number }[];
  scores: { average: number | null; best: Series[]; worst: Series[] };
  tags: { tag: string; count: number }[];
}

const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : `${Math.round(s / 60)}m`);

export function Anime() {
  const { filters } = useFilters();
  const q = useShows<AnimeData>("anime_page");
  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-[clamp(32px,3.6vw,52px)] font-extrabold leading-none">Anime</h1>
        <p className="mt-2 text-[15px] text-[#8c8c8c]">Sub or dub, simulcasts, studios and seasons, {rangeLabel(filters)}</p>
      </div>
      <QueryState q={q} minHeight={600} empty={(d) => !d.data.series.length}>
        {({ data }) => (
          <>
            <SubDub d={data} />
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
              <Simulcast d={data} />
              <Scores d={data} />
            </div>
            <Studios d={data} />
            <Seasons d={data} />
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <Spread title="By decade" subtitle="When your series first aired" rows={data.decades.map((x) => [x.decade, x.count])} />
              <Spread title="Formats" subtitle="TV, web (ONA), movies…" rows={data.formats.map((x) => [x.format, x.count])} />
              <Spread title="Top tags" subtitle="From AniList, weighted by episodes" rows={data.tags.slice(0, 8).map((x) => [x.tag, x.count])} />
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ sub vs dub

function SubDub({ d }: { d: AnimeData }) {
  const { sub, dub, sub_time_s, dub_time_s } = d.sub_dub;
  const total = sub + dub || 1;
  const maxMonth = Math.max(1, ...d.sub_dub_months.map((m) => m.sub + m.dub));
  const leaning = d.series.filter((s) => s.count >= 3);
  return (
    <Section title="Sub or dub" subtitle="From the audio language of each episode you played">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="flex items-end gap-6">
            <Big value={pct(sub / total)} label={`subbed · ${num(sub)} eps · ${hours(sub_time_s)}`} color={ORANGE} />
            <Big value={pct(dub / total)} label={`dubbed · ${num(dub)} eps · ${hours(dub_time_s)}`} color={TEAL} />
          </div>
          <div className="mt-5 flex h-2 gap-0.5" aria-hidden>
            <div style={{ width: `${(sub / total) * 100}%`, background: ORANGE }} />
            <div style={{ width: `${(dub / total) * 100}%`, background: TEAL }} />
          </div>
          {/* month by month, stacked */}
          <div className="mt-8 flex h-[120px] items-end gap-1" role="img" aria-label="Subbed and dubbed episodes per month">
            {d.sub_dub_months.map((m) => (
              <div key={m.month} className="flex h-full flex-1 flex-col justify-end" title={`${month(m.month)}: ${m.sub} sub, ${m.dub} dub`}>
                <div style={{ height: `${(m.dub / maxMonth) * 100}%`, background: TEAL }} />
                <div style={{ height: `${(m.sub / maxMonth) * 100}%`, background: ORANGE }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-[#8c8c8c]">
            <span>{d.sub_dub_months[0] && month(d.sub_dub_months[0].month)}</span>
            <span>{d.sub_dub_months.length > 1 && month(d.sub_dub_months[d.sub_dub_months.length - 1].month)}</span>
          </div>
        </div>
        <div className="lg:col-span-3">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-[#8c8c8c]">Per series (3+ episodes)</p>
          <ul className="flex flex-col">
            {leaning.slice(0, 9).map((s) => <SeriesRow key={s.key} s={s} right={
              <div className="w-40 shrink-0">
                <div className="flex h-1.5" aria-hidden>
                  <div style={{ width: `${(1 - (s.dub_share ?? 0)) * 100}%`, background: ORANGE }} />
                  <div style={{ width: `${(s.dub_share ?? 0) * 100}%`, background: TEAL }} />
                </div>
                <div className="mt-1 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-[#bbb]">{subDub(s.dub_share)}</div>
              </div>} />)}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ simulcast

function Simulcast({ d }: { d: AnimeData }) {
  const b = d.simulcast.buckets;
  const max = Math.max(1, ...Object.values(b));
  return (
    <Section title="Simulcast" subtitle="How soon after airing you watched each episode">
      <div className="flex items-end gap-4">
        <Big value={num(d.simulcast.episodes)} label="episodes within a week of airing" color={ORANGE} />
        {d.simulcast.median_days != null && (
          <Big value={d.simulcast.median_days >= 365 ? `${(d.simulcast.median_days / 365).toFixed(1)} yrs` : `${num(Math.round(d.simulcast.median_days))} days`}
               label="typical time after airing" />
        )}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {Object.entries(b).map(([label, n], i) => (
          <div key={label} className="flex items-center gap-3 text-[13px]">
            <span className="w-28 shrink-0 text-[#bbb]">{label}</span>
            <div className="h-3 flex-1 bg-[#151515]"><div className="h-full" style={{ width: `${(n / max) * 100}%`, background: i === 0 ? ORANGE : "#414141" }} /></div>
            <span className="w-10 shrink-0 text-right font-bold tabular">{num(n)}</span>
          </div>
        ))}
      </div>
      {d.simulcast.series.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-[12px] font-bold uppercase tracking-[0.06em] text-[#8c8c8c]">Kept up with as it aired</p>
          <PosterStrip items={d.simulcast.series.map((s) => ({ ...s, count: s.simulcast }))} unit="simulcast" />
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ scores

function Scores({ d }: { d: AnimeData }) {
  return (
    <Section title="AniList scores" subtitle="How the anime you watch is rated, weighted by episodes">
      {d.scores.average != null && <Big value={`★ ${d.scores.average}`} label="your average" color="#fab818" />}
      <p className="mb-1 mt-6 text-[12px] font-bold uppercase tracking-[0.06em] text-[#8c8c8c]">Highest rated you watched</p>
      <ul className="flex flex-col">{d.scores.best.map((s) => <SeriesRow key={s.key} s={s} right={<Score v={s.score} />} />)}</ul>
      {d.scores.worst.length > 0 && <>
        <p className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-[0.06em] text-[#8c8c8c]">Lowest rated</p>
        <ul className="flex flex-col">{d.scores.worst.map((s) => <SeriesRow key={s.key} s={s} right={<Score v={s.score} />} />)}</ul>
      </>}
    </Section>
  );
}

function Score({ v }: { v: number | null }) {
  return <span className="shrink-0 text-[15px] font-bold text-[#fab818]">★ {v}</span>;
}

// ------------------------------------------------------------------ studios and seasons

function Studios({ d }: { d: AnimeData }) {
  const max = Math.max(1, ...d.studios.map((s) => s.count));
  return (
    <Section title="Studios" subtitle="The main studio behind each series, by episodes you watched">
      <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
        {d.studios.slice(0, 8).map((s, i) => (
          <div key={s.name} className="flex items-center gap-4">
            <span className="cr-display w-7 shrink-0 text-right text-[24px] font-extrabold text-[#414141]">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[16px] font-bold">{s.name}</span>
                <span className="shrink-0 text-[12px] text-[#8c8c8c]">{num(s.count)} eps · {hours(s.time_s)}</span>
              </div>
              <div className="mt-1.5 h-1 bg-[#151515]"><div className="h-full" style={{ width: `${(s.count / max) * 100}%`, background: ORANGE }} /></div>
              <div className="mt-2.5"><PosterStrip items={s.series} small /></div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Seasons({ d }: { d: AnimeData }) {
  return (
    <Section title="Your anime seasons" subtitle="Each series under the season it first aired">
      <div className="no-scrollbar -mx-[4%] flex gap-8 overflow-x-auto px-[4%] pb-2">
        {d.seasons.map((z) => (
          <div key={z.season} className="shrink-0">
            <div className="mb-2 flex items-center gap-2">
              <Tag tone={z.season.startsWith("Fall") ? "orange" : z.season.startsWith("Winter") ? "teal" : z.season.startsWith("Spring") ? "light" : "dark"}>{z.season}</Tag>
              <span className="text-[12px] text-[#8c8c8c]">{num(z.count)} eps</span>
            </div>
            <PosterStrip items={z.series} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ small pieces

function Spread({ title, subtitle, rows }: { title: string; subtitle: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Section title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-2.5">
        {rows.map(([label, n], i) => (
          <div key={label}>
            <div className="flex justify-between text-[13px]"><span className="truncate font-medium">{label}</span><span className="font-bold tabular">{num(n)}</span></div>
            <div className="mt-1 h-1 bg-[#151515]"><div className="h-full" style={{ width: `${(n / max) * 100}%`, background: i === 0 ? ORANGE : "#8c8c8c" }} /></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Big({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="cr-display text-[clamp(34px,3.4vw,52px)] font-extrabold leading-none" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[12px] font-medium uppercase tracking-[0.05em] text-[#8c8c8c]">{label}</div>
    </div>
  );
}

function SeriesRow({ s, right }: { s: Series; right: ReactNode }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/channel/${s.key}${q}`} className="-mx-3 flex items-center gap-4 px-3 py-2 transition-colors duration-150 hover:bg-[#151515]">
        <div className="w-9 shrink-0"><PosterImg src={s.poster} /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">{s.title}</div>
          <Meta items={[`${num(s.count)} ep${s.count === 1 ? "" : "s"}`, s.studios[0], s.anime_season]} />
        </div>
        {right}
      </Link>
    </li>
  );
}

function PosterStrip({ items, small = false, unit = "eps" }: { items: Brief[]; small?: boolean; unit?: string }) {
  const q = useLinkQuery();
  return (
    <div className="flex gap-2">
      {items.slice(0, small ? 6 : 8).map((s) => (
        <Link key={s.key} to={`/channel/${s.key}${q}`} title={`${s.title} · ${num(s.count)} ${unit}`}
              className={`${small ? "w-11" : "w-[88px]"} shrink-0 transition-opacity duration-150 hover:opacity-80`}>
          <PosterImg src={s.poster} />
          {!small && <div className="mt-1.5 truncate text-[12px] font-medium">{s.title}</div>}
        </Link>
      ))}
    </div>
  );
}
