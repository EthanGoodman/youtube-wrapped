/* The Anime page (Crunchyroll) in the shared look: what only anime data can tell. Sub or dub first (the question
   people ask), then simulcasts and AniList scores, the studios behind your series, the seasons they aired in, and
   decades / formats / tags. */
import { ReactNode, useState } from "react";
import { Link } from "../platform";
import { useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { num, pct } from "../format";
import { subDub } from "../families/shows/animeUi";
import { OV, PageBody, PageHeader, Poster, ScrollRow, Skeleton, StatsFrame, kicker } from "./kit";
import { Readout, Ticks } from "./charts";
import { hoursShort, periodTitle } from "./takeaways";

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

const SUB = OV.mustard;
const DUB = OV.teal;
const eps = (n: number) => `${num(n)} episode${n === 1 ? "" : "s"}`;
const monthLabel = (k: string, long = true) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", long ? { month: "long", year: "numeric" } : { month: "short" });
const FORMATS: Record<string, string> = { TV: "TV series", ONA: "Web (ONA)", OVA: "OVA", MOVIE: "Movies", SPECIAL: "Specials", TV_SHORT: "TV shorts" };

export function AnimePage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const q = useStats<{ data: AnimeData }>("shows/anime_page");
  const d = q.data?.data;
  const total = d ? d.sub_dub.sub + d.sub_dub.dub : 0;
  const subShare = total ? d!.sub_dub.sub / total : 0;
  const title = !d ? "Anime" : !total ? "Your anime" : subShare >= 0.5 ? `Subbed, ${pct(subShare)} of the time.` : `Dubbed, ${pct(1 - subShare)} of the time.`;
  return (
    <StatsFrame>
      <PageHeader label={`Anime · ${periodTitle(filters, meta?.today)}`} title={title}>
        <p className="text-[17px]" style={{ color: OV.mute }}>Sub or dub, simulcasts, scores, studios and seasons, from {d ? `${num(d.series_count)} series` : "your series"}.</p>
      </PageHeader>
      <PageBody>
        {!d ? <Skeleton h={500} /> : !d.series.length ? <p style={{ color: OV.soft }}>No anime in this period.</p> : (
          <>
            <SubDub d={d} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Simulcast d={d} />
              <Scores d={d} />
            </div>
            <Studios d={d} />
            <Seasons d={d} />
            <div className="grid gap-4 lg:grid-cols-3">
              <Spread label="When your series first aired" title="By decade" rows={d.decades.map((x) => [x.decade, x.count])} />
              <Spread label="TV, web, movies…" title="Formats" rows={d.formats.map((x) => [FORMATS[x.format] ?? x.format, x.count])} />
              <Spread label="From AniList, by episodes" title="Top tags" rows={d.tags.slice(0, 8).map((x) => [x.tag, x.count])} />
            </div>
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ sub or dub

function SubDub({ d }: { d: AnimeData }) {
  const { sub, dub, sub_time_s, dub_time_s } = d.sub_dub;
  const total = sub + dub || 1;
  const [on, setOn] = useState<string | null>(null);
  const months = fillMonths(d.sub_dub_months);
  const max = Math.max(1, ...months.map((m) => m.sub + m.dub));
  const hovered = months.find((m) => m.month === on);
  const many = months.length > 24;
  const leaning = d.series.filter((s) => s.count >= 3).slice(0, 8);
  return (
    <section className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl p-5 sm:p-7" style={{ background: OV.ink, color: OV.paper }}>
        <span className={kicker} style={{ color: OV.mute }}>Sub or dub · from the audio of each episode you played</span>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
          <Big value={pct(sub / total)} label={`subbed · ${eps(sub)} · ${hoursShort(sub_time_s)}`} color={SUB} />
          <Big value={pct(dub / total)} label={`dubbed · ${eps(dub)} · ${hoursShort(dub_time_s)}`} color="#7FB8AE" />
        </div>
        <span className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${pct(sub / total)} subbed, ${pct(dub / total)} dubbed`}>
          <span style={{ width: `${(sub / total) * 100}%`, background: SUB }} />
          <span style={{ width: `${(dub / total) * 100}%`, background: DUB }} />
        </span>
        {months.length > 1 && (
          <div className="flex flex-1 flex-col gap-2">
            <Readout dark active={!!hovered}
                     text={hovered ? `${monthLabel(hovered.month)} · ${num(hovered.sub)} subbed, ${num(hovered.dub)} dubbed` : "Month by month. Hover one to see it."} />
            <div className="grid min-h-[130px] flex-1 items-end gap-[3px]" role="img" aria-label="Subbed and dubbed episodes per month" onMouseLeave={() => setOn(null)}
                 style={{ gridTemplateColumns: `repeat(${months.length},minmax(0,1fr))` }}>
              {months.map((m) => (
                <span key={m.month} onMouseEnter={() => setOn(m.month)} className="flex h-full flex-col justify-end transition-opacity duration-150"
                      style={{ opacity: on && on !== m.month ? 0.3 : 1 }}>
                  <span style={{ height: `${(m.dub / max) * 100}%`, background: DUB, borderRadius: m.dub ? "3px 3px 0 0" : 0 }} />
                  <span style={{ height: `${(m.sub / max) * 100}%`, background: SUB, borderRadius: m.dub ? 0 : "3px 3px 0 0" }} />
                </span>
              ))}
            </div>
            <Ticks dark labels={months.map((m) => (m.month.endsWith("-01") ? m.month.slice(0, 4) : many ? "" : monthLabel(m.month, false)))} />
          </div>
        )}
      </div>
      <Card label="Per series · 3+ episodes" title="Who you watch which way">
        <ul className="flex flex-col">
          {leaning.map((s) => (
            <SeriesRow key={s.key} s={s} right={
              <span className="flex w-28 shrink-0 flex-col items-end gap-1">
                <span className="flex h-2 w-full overflow-hidden rounded-full" aria-hidden>
                  <span style={{ width: `${(1 - (s.dub_share ?? 0)) * 100}%`, background: SUB }} />
                  <span style={{ width: `${(s.dub_share ?? 0) * 100}%`, background: DUB }} />
                </span>
                <span className="font-shelf-mono text-[11px]">{subDub(s.dub_share) ?? "–"}</span>
              </span>} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------ simulcast and scores

function Simulcast({ d }: { d: AnimeData }) {
  const b = Object.entries(d.simulcast.buckets);
  const max = Math.max(1, ...b.map(([, n]) => n));
  const m = d.simulcast.median_days;
  return (
    <Card label="Simulcast · how soon after airing you watched" title={d.simulcast.episodes ? `${eps(d.simulcast.episodes)} the week they aired` : "You watch on your own time"}>
      {m != null && <p className="text-[15px]">Usually <strong>{m >= 365 ? `${(m / 365).toFixed(1)} years` : `${num(Math.round(m))} days`}</strong> after an episode first aired.</p>}
      <div className="flex flex-col gap-2">
        {b.map(([label, n], i) => (
          <div key={label} className="flex items-center gap-3 text-[14px]">
            <span className="w-28 shrink-0">{label}</span>
            <span className="h-3.5 flex-1 overflow-hidden rounded-full" style={{ background: OV.sand }}>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, (n / max) * 100)}%`, background: i === 0 ? OV.accent : OV.ink }} />
            </span>
            <span className="w-12 shrink-0 text-right font-ov-display text-[15px] font-extrabold">{num(n)}</span>
          </div>
        ))}
      </div>
      {d.simulcast.series.length > 0 && (
        <>
          <span className={kicker} style={{ color: OV.soft }}>Kept up with as it aired</span>
          <PosterStrip items={d.simulcast.series.map((s) => ({ ...s, count: s.simulcast }))} unit="the week they aired" />
        </>
      )}
    </Card>
  );
}

function Scores({ d }: { d: AnimeData }) {
  return (
    <Card label="AniList scores · weighted by episodes" title={d.scores.average != null ? `You watch anime rated ${d.scores.average} on average` : "AniList scores"}>
      <span className={kicker} style={{ color: OV.soft }}>Highest rated you watched</span>
      <ul className="flex flex-col">{d.scores.best.map((s) => <SeriesRow key={s.key} s={s} right={<Score v={s.score} />} />)}</ul>
      {d.scores.worst.length > 0 && (
        <>
          <span className={kicker} style={{ color: OV.soft }}>Lowest rated</span>
          <ul className="flex flex-col">{d.scores.worst.map((s) => <SeriesRow key={s.key} s={s} right={<Score v={s.score} />} />)}</ul>
        </>
      )}
    </Card>
  );
}

function Score({ v }: { v: number | null }) {
  return <span className="shrink-0 rounded-full border-2 px-2.5 py-0.5 font-ov-display text-[15px] font-extrabold" style={{ borderColor: OV.ink, background: OV.mustard }}>{v ?? "–"}</span>;
}

// ------------------------------------------------------------------ studios and seasons

function Studios({ d }: { d: AnimeData }) {
  const max = Math.max(1, ...d.studios.map((s) => s.count));
  const top = d.studios[0];
  return (
    <Card label="Studios · the main studio behind each series" title={top ? `${top.name} made the most of what you watched` : "Studios"}>
      <ol className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        {d.studios.slice(0, 8).map((s, i) => (
          <li key={s.name} className="flex min-w-0 items-start gap-3">
            <span className="w-6 shrink-0 text-right font-ov-display text-[18px] font-extrabold">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[16px] font-bold">{s.name}</span>
                <span className="shrink-0 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{eps(s.count)} · {hoursShort(s.time_s)}</span>
              </span>
              <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: OV.sand }}>
                <span className="block h-full rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: i === 0 ? OV.mustard : OV.ink }} />
              </span>
              <PosterStrip items={s.series} small />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Seasons({ d }: { d: AnimeData }) {
  const tone = (s: string) => (s.startsWith("Winter") ? [OV.teal, OV.paper] : s.startsWith("Spring") ? ["#E8D2A6", OV.ink] : s.startsWith("Summer") ? [OV.mustard, OV.ink] : [OV.accent, OV.paper]);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b-2 pb-3" style={{ borderColor: OV.ink }}>
        <span className={kicker} style={{ color: OV.soft }}>Your anime seasons · each series under the season it first aired</span>
        <h2 className="font-ov-display text-[clamp(26px,3vw,36px)] font-extrabold leading-tight">{d.seasons.length} seasons of anime</h2>
      </div>
      <ScrollRow outer="-mx-4 sm:mx-0" className="px-4 pb-2 sm:px-0">
        <ol className="flex w-max gap-6">
          {d.seasons.map((z) => {
            const [bg, fg] = tone(z.season);
            return (
              <li key={z.season} className="flex shrink-0 flex-col gap-2">
                <span className="flex items-center gap-2">
                  <span className="rounded-full border-2 px-3 py-0.5 font-ov-display text-[14px] font-extrabold" style={{ background: bg, color: fg, borderColor: OV.ink }}>{z.season}</span>
                  <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{eps(z.count)}</span>
                </span>
                <PosterStrip items={z.series} />
              </li>
            );
          })}
        </ol>
      </ScrollRow>
    </section>
  );
}

// ------------------------------------------------------------------ small pieces

function Spread({ label, title, rows }: { label: string; title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Card label={label} title={title}>
      <div className="flex flex-col gap-2.5">
        {rows.map(([l, n], i) => (
          <div key={l} className="flex flex-col gap-1">
            <span className="flex justify-between gap-3 text-[14px]"><span className="truncate font-medium">{l}</span>
              <span className="font-ov-display font-extrabold">{num(n)}</span></span>
            <span className="block h-2 overflow-hidden rounded-full" style={{ background: OV.sand }}>
              <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: i === 0 ? OV.mustard : OV.ink }} />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Big({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ov-display text-[clamp(44px,5vw,72px)] font-extrabold leading-none" style={{ color }}>{value}</span>
      <span className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{label}</span>
    </div>
  );
}

function Card({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6" style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        <h2 className="font-ov-display text-[24px] font-extrabold leading-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SeriesRow({ s, right }: { s: Series; right: ReactNode }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/channel/${encodeURIComponent(s.key)}${q}`} className="flex items-center gap-3 border-b py-2 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        <Poster src={s.poster} name={s.title} width="38px" className="!rounded-md !border-2" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold">{s.title}</span>
          <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{[eps(s.count), s.studios[0], s.anime_season].filter(Boolean).join(" · ")}</span>
        </span>
        {right}
      </Link>
    </li>
  );
}

function PosterStrip({ items, small = false, unit = "episodes" }: { items: Brief[]; small?: boolean; unit?: string }) {
  const q = useLinkQuery();
  return (
    <div className="flex gap-2">
      {items.slice(0, small ? 6 : 8).map((s) => (
        <Link key={s.key} to={`/channel/${encodeURIComponent(s.key)}${q}`} title={`${s.title} · ${num(s.count)} ${unit}`}
              className={`flex ${small ? "w-10" : "w-[84px]"} shrink-0 flex-col gap-1 transition-transform hover:-translate-y-0.5`}>
          <Poster src={s.poster} name={s.title} width="100%" className={small ? "!rounded-md !border-2" : ""} />
          {!small && <span className="truncate text-[12px] font-bold">{s.title}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Every month from the first to the last, empty ones included, so a break shows as a gap. */
function fillMonths(data: AnimeData["sub_dub_months"]): AnimeData["sub_dub_months"] {
  if (!data.length) return data;
  const got = new Map(data.map((m) => [m.month, m]));
  const out: AnimeData["sub_dub_months"] = [];
  let [y, m] = data[0].month.split("-").map(Number);
  const [ey, em] = data[data.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(got.get(key) ?? { month: key, sub: 0, dub: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
