/* A series' page on Crunchyroll: your stats for it in Crunchyroll's look (banner hero fading to black,
   info tags, 16:9 episode rows with the progress bar inside the still, orange-underlined seasons). */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import { MonthPoint, useStats } from "../../api";
import { Link } from "../../platform";
import { QueryState, Section } from "../../components/ui";
import { MeasureToggle, MonthlyBars, useMeasure } from "../../components/charts";
import { ShowProgress } from "./data";
import { Bar, Meta, ORANGE, PosterImg, STATUS, TEAL, Tag, subDub } from "./animeUi";
import { date, num } from "../../format";
import { useLinkQuery } from "../../filters";

interface Episode { number: number; name: string | null; runtime_min: number | null; air_date: string | null; aired: boolean;
                    still: string | null; watched: boolean; first: string | null; times: number; pct: number | null; dubbed: boolean | null }
interface Season { season: number; episodes: Episode[]; aired: number; watched: number }
interface Binge { season: number; episodes: number; days: number; start: string; end: string }
interface Card { key: string; title: string; poster: string | null; backdrop: string | null; year: string | null; seasons: number | null;
                 genres: string[]; overview: string | null; studios: string[]; anime_season: string | null; score: number | null;
                 format: string | null; simulcast: boolean }
interface Detail {
  show: Card;
  progress: ShowProgress | null;
  seasons: Season[];
  other_episodes: { title: string | null; season: string | null; first: string; times: number; pct: number | null; dubbed: boolean | null; still: string | null }[];
  pace: { days: number; first: string | null; last: string | null; per_day: number; best_day: { date: string; episodes: number } | null;
          fastest_season: Binge | null; seasons_binged: Binge[] };
  similar: (Card & { count: number; shared: number })[];
  time_s: number;
  episodes_watched: number;
  dub_share: number | null;
}

const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : `${Math.round(s / 60)}m`);
const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);
const eps = (n: number) => `${num(n)} ep${n === 1 ? "" : "s"}`;

export function AnimeShowPage() {
  const { id = "" } = useParams();
  const d = useStats<Detail>(`show/${encodeURIComponent(id)}`);
  const monthly = useStats<{ monthly: MonthPoint[] }>(`channel/${encodeURIComponent(id)}`);
  const [measure, setMeasure] = useMeasure();
  return (
    <QueryState q={d} minHeight={600}>
      {(s) => (
        <div className="flex flex-col gap-12">
          <Hero d={s} />
          <Pace d={s} />
          {(s.seasons.length > 0 || s.other_episodes.length > 0) && <Episodes d={s} />}
          <Section title="When you watched it" subtitle="Episodes per month" action={<MeasureToggle value={measure} onChange={setMeasure} />}>
            {monthly.data?.monthly.length ? <MonthlyBars data={monthly.data.monthly} measure={measure} /> : <div className="h-[260px]" />}
          </Section>
          {s.similar.length > 0 && <Similar d={s} />}
        </div>
      )}
    </QueryState>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ d }: { d: Detail }) {
  const show = d.show;
  const p = d.progress;
  const sd = subDub(d.dub_share);
  return (
    <section className="relative -mt-[124px] ml-[calc(50%-50vw)] w-screen overflow-hidden md:-mt-[144px] xl:-mt-[100px]">
      {show.backdrop && <img src={show.backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-70" />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #000 8%, rgba(0,0,0,.85) 45%, rgba(0,0,0,.25) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, #0000 45%, #000 90%)" }} />
      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-8 px-[4%] pb-12 pt-[164px] md:flex-row md:items-end md:pt-[190px] xl:pt-[150px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            {sd && <Tag tone={sd === "Dub" ? "teal" : "orange"}>{sd}</Tag>}
            {show.simulcast && <Tag tone="light">Simulcast</Tag>}
            {show.anime_season && <Tag>{show.anime_season}</Tag>}
            {show.studios[0] && <Tag>{show.studios[0]}</Tag>}
            {show.format && show.format !== "TV" && <Tag>{show.format.replace("_", " ")}</Tag>}
            {show.score != null && <Tag tone="gold">★ {show.score}</Tag>}
          </div>
          <h1 className="mt-4 text-[clamp(36px,4.8vw,72px)] font-extrabold leading-[0.95]">{show.title}</h1>
          <Meta className="mt-3 text-[13px]" items={[show.year, show.seasons ? `${show.seasons} season${show.seasons === 1 ? "" : "s"}` : null, ...show.genres.slice(0, 3)]} />
          {show.overview && <p className="mt-4 line-clamp-3 max-w-[640px] text-[15px] leading-snug text-[#bbb]">{show.overview}</p>}
          <div className="mt-8 flex flex-wrap gap-x-9 gap-y-4">
            <Figure value={num(p?.total ? p.watched : d.episodes_watched)} label={p?.total ? `of ${num(p.total)} episodes` : "episodes"} color={ORANGE} />
            <Figure value={hours(d.time_s)} label="watched" />
            <Figure value={num(d.pace.days)} label={d.pace.days === 1 ? "day" : "days with it"} />
          </div>
          {p && (
            <div className="mt-6 max-w-[560px]">
              <div className="flex items-center justify-between">
                <Tag tone={p.status === "finished" ? "teal" : p.status === "watching" ? "orange" : "dark"}>{STATUS[p.status].label}</Tag>
                {p.pct != null && <span className="text-[13px] font-bold">{Math.round(p.pct * 100)}%</span>}
              </div>
              <Bar pct={p.pct} status={p.status} className="mt-2" />
              {d.pace.first && <p className="mt-2 text-[12px] text-[#8c8c8c]">{d.pace.first === d.pace.last ? date(d.pace.first) : `${date(d.pace.first)} – ${date(d.pace.last!)}`}</p>}
            </div>
          )}
        </div>
        <div className="hidden w-[180px] shrink-0 md:block lg:w-[210px]"><PosterImg src={show.poster} /></div>
      </div>
    </section>
  );
}

function Figure({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className="cr-display text-[clamp(30px,3vw,46px)] font-extrabold leading-none" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[12px] font-medium uppercase tracking-[0.05em] text-[#8c8c8c]">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------ pace

function Pace({ d }: { d: Detail }) {
  const f = d.pace.fastest_season;
  const tiles: [string, string, string][] = [
    ["Fastest season", f ? days(f.days) : "–", f ? `Season ${d.seasons.findIndex((s) => s.season === f.season) + 1} · ${eps(f.episodes)}` : "none finished within 30 days"],
    ["Most in one day", d.pace.best_day ? eps(d.pace.best_day.episodes) : "–", d.pace.best_day ? date(d.pace.best_day.date) : ""],
    ["Per day watched", eps(Math.round(d.pace.per_day * 10) / 10), `over ${days(d.pace.days)}`],
    ["Seasons done", d.seasons.length ? `${num(d.seasons.filter((s) => s.aired && s.watched >= s.aired).length)} of ${num(d.seasons.length)}` : "–",
     d.pace.seasons_binged.length ? `${num(d.pace.seasons_binged.length)} binged in under a month` : ""],
  ];
  return (
    <div className="grid grid-cols-2 gap-px bg-[#272727] lg:grid-cols-4">
      {tiles.map(([k, v, sub]) => (
        <div key={k} className="bg-black px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c8c8c]">{k}</div>
          <div className="cr-display mt-2 text-[28px] font-extrabold leading-none">{v}</div>
          {sub && <div className="mt-1.5 text-[12px] text-[#bbb]">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ episodes

function Episodes({ d }: { d: Detail }) {
  const start = useMemo<number | "other">(() => {
    const placed = d.seasons.reduce((n, s) => n + s.watched, 0);
    if (!d.seasons.length || d.other_episodes.length > placed) return "other";
    const unfinished = d.seasons.find((s) => s.watched > 0 && s.watched < s.aired);
    return unfinished?.season ?? [...d.seasons].reverse().find((s) => s.watched > 0)?.season ?? d.seasons[0].season;
  }, [d.seasons, d.other_episodes.length]);
  const [season, setSeason] = useState<number | "other">(start);
  const [open, setOpen] = useState(false);
  useEffect(() => setSeason(start), [start]);
  const current = d.seasons.find((s) => s.season === season);
  const many = d.seasons.length > 6;
  const label = (n: number) => d.seasons.findIndex((s) => s.season === n) + 1;
  return (
    <Section title="Episodes" subtitle="Every episode out, and how much of each you watched"
             action={many && (
               <div className="relative">
                 <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="nf-select">
                   {current ? `Season ${label(current.season)}` : "Other episodes"} <CaretDown size={14} weight="fill" />
                 </button>
                 {open && (
                   <div className="nf-menu absolute right-0 top-full z-30 mt-1 max-h-[340px] w-56 overflow-y-auto py-1">
                     {d.seasons.map((s) => (
                       <button key={s.season} onClick={() => { setSeason(s.season); setOpen(false); }}
                               className={`flex w-full justify-between px-4 py-2 text-left text-[14px] hover:bg-[#151515] ${s.season === season ? "font-bold text-[#ff640a]" : ""}`}>
                         Season {label(s.season)} <span className="text-[12px] text-[#8c8c8c]">{s.watched}/{s.aired}</span>
                       </button>
                     ))}
                   </div>
                 )}
               </div>
             )}>
      {/* season tabs with Crunchyroll's orange underline, each with its own progress */}
      {!many && (d.seasons.length > 1 || d.other_episodes.length > 0) && (
        <div className="no-scrollbar -mx-[4%] mb-6 flex gap-6 overflow-x-auto border-b border-[#272727] px-[4%]" role="tablist">
          {d.seasons.map((s) => <SeasonTab key={s.season} on={season === s.season} onClick={() => setSeason(s.season)}
                                           label={`Season ${label(s.season)}`} sub={`${s.watched}/${s.aired}`} />)}
          {d.other_episodes.length > 0 && <SeasonTab on={season === "other"} onClick={() => setSeason("other")}
                                                    label="Other" sub={`${d.other_episodes.length}`} />}
        </div>
      )}
      {current ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 xl:grid-cols-2">
          {current.episodes.map((e) => (
            <EpisodeRow key={e.number} still={e.still} code={`S${label(current.season)} E${e.number}`} title={e.name ?? `Episode ${e.number}`}
                        runtime={e.runtime_min} watched={e.watched} pct={e.pct} dubbed={e.dubbed} first={e.first} times={e.times}
                        aired={e.aired} airDate={e.air_date} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 xl:grid-cols-2">
          {d.other_episodes.map((e, i) => (
            <EpisodeRow key={i} still={e.still} code={e.season ?? "Episode"} title={e.title ?? "Episode"} runtime={null}
                        watched pct={e.pct} dubbed={e.dubbed} first={e.first} times={e.times} aired airDate={null} />
          ))}
        </div>
      )}
    </Section>
  );
}

function SeasonTab({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick}
            className={`relative shrink-0 pb-3 pt-1 text-[14px] font-bold uppercase tracking-[0.04em] transition-colors duration-150 ${on ? "text-white" : "text-[#8c8c8c] hover:text-white"}`}>
      {label} <span className="ml-1 text-[12px] font-medium normal-case text-[#8c8c8c]">{sub}</span>
      <span className={`absolute inset-x-0 bottom-0 h-1 origin-left bg-[#ff640a] transition-transform duration-150 ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
    </button>
  );
}

function EpisodeRow(e: { still: string | null; code: string; title: string; runtime: number | null; watched: boolean; pct: number | null;
                         dubbed: boolean | null; first: string | null; times: number; aired: boolean; airDate: string | null }) {
  const dim = !e.watched;
  return (
    <div className={`-mx-3 flex gap-4 px-3 py-2.5 transition-colors duration-150 hover:bg-[#151515] ${dim ? "opacity-50" : ""}`}>
      <div className="relative aspect-video w-[132px] shrink-0 bg-[#151515] sm:w-[160px]">
        {e.still && <img src={e.still} alt="" loading="lazy" className={`h-full w-full object-cover ${dim ? "grayscale" : ""}`} />}
        {e.runtime && <span className="absolute bottom-1 right-1 bg-[#0009] px-[5px] py-[3px] text-[11px] font-medium leading-none">{e.runtime}m</span>}
        {e.watched && <div className="absolute inset-x-0 bottom-0 h-1 bg-[#0009]"><div className="h-full bg-[#ff640a]" style={{ width: `${(e.pct ?? 1) * 100}%` }} /></div>}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="text-[12px] font-medium text-[#8c8c8c]">{e.code}</div>
        <div className="line-clamp-2 text-[14px] font-bold leading-snug">{e.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
          {e.watched ? (
            <>
              {(e.pct ?? 1) >= 0.9
                ? <span className="inline-flex items-center gap-1 font-bold" style={{ color: TEAL }}><CheckCircle size={14} weight="fill" /> {date(e.first!)}</span>
                : <span className="font-bold" style={{ color: ORANGE }}>{Math.round((e.pct ?? 0) * 100)}% · {date(e.first!)}</span>}
              {e.dubbed != null && <Tag tone={e.dubbed ? "teal" : "dark"}>{e.dubbed ? "Dub" : "Sub"}</Tag>}
              {e.times > 1 && <span className="text-[#8c8c8c]">{e.times}×</span>}
            </>
          ) : <span className="text-[#8c8c8c]">{e.aired ? "Not watched" : `Airs ${e.airDate ? date(e.airDate) : "later"}`}</span>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ similar

function Similar({ d }: { d: Detail }) {
  const q = useLinkQuery();
  return (
    <Section title="Your other series like this" subtitle={`Sharing its genres: ${d.show.genres.slice(0, 3).join(", ")}`}>
      <div className="grid grid-cols-3 gap-5 sm:grid-cols-5 lg:grid-cols-8">
        {d.similar.slice(0, 8).map((s) => (
          <Link key={s.key} to={`/channel/${s.key}${q}`} className="group min-w-0">
            <div className="transition-opacity duration-150 group-hover:opacity-80"><PosterImg src={s.poster} /></div>
            <div className="mt-2 truncate text-[13px] font-medium">{s.title}</div>
            <Meta items={[eps(s.count), s.studios?.[0]]} />
          </Link>
        ))}
      </div>
    </Section>
  );
}
