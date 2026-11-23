/* A show's page on Netflix: your stats for that show, in the Netflix mood (backdrop header,
   red accents, episode checklist by season). A stats page, not a place to press play. */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { MonthPoint, useStats } from "../../api";
import { Link } from "../../platform";
import { QueryState, Section } from "../../components/ui";
import { MeasureToggle, MonthlyBars, useMeasure } from "../../components/charts";
import { ShowProgress, ShowStatus } from "./data";
import { date, duration, num } from "../../format";
import { useLinkQuery } from "../../filters";

interface Episode { number: number; name: string | null; runtime_min: number | null; air_date: string | null; aired: boolean;
                    still: string | null; watched: boolean; first: string | null; times: number }
interface Season { season: number; episodes: Episode[]; aired: number; watched: number }
interface Binge { season: number; episodes: number; days: number; start: string; end: string }
interface ShowCard { key: string; title: string; poster: string | null; backdrop: string | null; year: string | null;
                     seasons: number | null; genres: string[]; overview: string | null; episodes_total: number | null }
interface ShowDetail {
  show: ShowCard;
  progress: ShowProgress | null;
  seasons: Season[];
  other_episodes: { title: string | null; season: string | null; first: string; times: number }[];
  pace: { days: number; first: string | null; last: string | null; per_day: number;
          best_day: { date: string; episodes: number } | null; fastest_season: Binge | null; seasons_binged: Binge[] };
  similar: (ShowCard & { count: number; shared: number })[];
  time_s: number;
  episodes_watched: number;
  views: number;
}

const RED = "rgb(var(--c-accent))";
const GREEN = "rgb(var(--c-up))";
const STATUS: Record<ShowStatus, [string, string]> = { finished: ["Finished", GREEN], watching: ["Watching", RED], dropped: ["Dropped", "#b3b3b3"] };
const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : duration(s));
const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);
const eps = (n: number) => `${num(n)} ep${n === 1 ? "" : "s"}`;

export function ShowPage() {
  const { id = "" } = useParams();
  const d = useStats<ShowDetail>(`show/${encodeURIComponent(id)}`);
  const monthly = useStats<{ monthly: MonthPoint[] }>(`channel/${encodeURIComponent(id)}`);
  const [measure, setMeasure] = useMeasure();
  return (
    <QueryState q={d} minHeight={600}>
      {(s) => (
        <div className="flex flex-col gap-10 md:gap-12">
          <Header d={s} />
          <PaceTiles d={s} />
          {(s.seasons.length > 0 || s.other_episodes.length > 0) && <EpisodeChecklist d={s} />}
          <Section title="When you watched it" subtitle="Episodes per month, all time" action={<MeasureToggle value={measure} onChange={setMeasure} />}>
            {monthly.data?.monthly.length
              ? <MonthlyBars data={fill(monthly.data.monthly)} measure={measure} />
              : <div className="h-[260px]" />}
          </Section>
          {s.similar.length > 0 && <Similar items={s.similar} genres={s.show.genres} />}
        </div>
      )}
    </QueryState>
  );
}

// ------------------------------------------------------------------ header

function Header({ d }: { d: ShowDetail }) {
  const p = d.progress;
  const show = d.show;
  const [label, color] = p ? STATUS[p.status] : ["", ""];
  const meta = [show.year, show.seasons ? `${show.seasons} Season${show.seasons === 1 ? "" : "s"}` : null, show.genres.slice(0, 3).join(" • ") || null].filter(Boolean);
  return (
    <section className="relative -mt-[104px] ml-[calc(50%-50vw)] w-screen overflow-hidden md:-mt-[92px]">
      {show.backdrop && <img src={show.backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-50" />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #141414 10%, rgba(20,20,20,.8) 50%, rgba(20,20,20,.3) 100%)" }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: "linear-gradient(180deg, transparent, #141414)" }} />
      <div className="absolute inset-x-0 top-0 h-32" style={{ background: "linear-gradient(0deg, transparent, rgba(0,0,0,.6))" }} />
      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-8 px-[4%] pb-10 pt-[124px] md:flex-row md:items-end md:pb-14 md:pt-[150px]">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[#e5e5e5] md:text-[15px]">{meta.join("  ·  ")}</p>
          <h1 className="mt-2 text-[clamp(36px,5vw,76px)] font-black leading-[0.95] tracking-[-0.03em]">{show.title}</h1>
          {show.overview && <p className="mt-4 line-clamp-3 max-w-[640px] text-[15px] leading-snug text-[#e5e5e5] md:text-[17px]">{show.overview}</p>}
          <div className="mt-8 flex flex-wrap gap-x-9 gap-y-4">
            <Figure value={num(d.episodes_watched)} label={p?.total ? `of ${num(p.total)} episodes` : "episodes watched"} accent />
            <Figure value={hours(d.time_s)} label="watched" />
            <Figure value={num(d.pace.days)} label={d.pace.days === 1 ? "day" : "days with it"} />
            {d.views > d.episodes_watched && <Figure value={num(d.views - d.episodes_watched)} label="rewatched" />}
          </div>
          {p && (
            <div className="mt-6 max-w-[560px]">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-bold uppercase tracking-[0.15em]" style={{ color }}>{label}</span>
                {p.pct != null && <span className="font-bold">{Math.round(p.pct * 100)}%</span>}
              </div>
              <div className="mt-1.5 h-1 bg-[#404040]"><div className="h-full" style={{ width: `${(p.pct ?? 0) * 100}%`, background: color }} /></div>
              {d.pace.first && (
                <p className="mt-2 text-[13px] text-[#b3b3b3]">
                  {d.pace.first === d.pace.last ? `Watched ${date(d.pace.first)}` : `${date(d.pace.first)} – ${date(d.pace.last!)}`}
                </p>
              )}
            </div>
          )}
        </div>
        {show.poster && (
          <img src={show.poster.replace("/w185/", "/w342/")} alt="" className="hidden w-[170px] shrink-0 rounded-[4px] shadow-[0_10px_40px_rgba(0,0,0,.6)] md:block lg:w-[200px]" />
        )}
      </div>
    </section>
  );
}

function Figure({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[clamp(30px,3.2vw,48px)] font-black leading-none tracking-tight" style={accent ? { color: RED } : undefined}>{value}</div>
      <div className="mt-1.5 text-[13px] text-[#b3b3b3]">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------ pace

function PaceTiles({ d }: { d: ShowDetail }) {
  const f = d.pace.fastest_season;
  const tiles: [string, string, string][] = [
    ["Fastest season", f ? days(f.days) : "–", f ? `Season ${f.season} · ${num(f.episodes)} episodes` : "no season binged within 30 days"],
    ["Most in one day", d.pace.best_day ? eps(d.pace.best_day.episodes) : "–", d.pace.best_day ? date(d.pace.best_day.date) : ""],
    ["Per day watched", eps(Math.round(d.pace.per_day * 10) / 10), `over ${days(d.pace.days)}`],
    ["Seasons done", d.seasons.length ? `${num(d.seasons.filter((s) => s.aired && s.watched >= s.aired).length)} of ${num(d.seasons.length)}` : "–",
     d.pace.seasons_binged.length ? `${num(d.pace.seasons_binged.length)} binged in under a month` : ""],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] bg-white/[0.06] lg:grid-cols-4">
      {tiles.map(([k, v, sub]) => (
        <div key={k} className="bg-[#181818] px-5 py-4">
          <div className="text-[12px] font-bold uppercase tracking-[0.15em] text-[#808080]">{k}</div>
          <div className="mt-2 text-[28px] font-black leading-none tracking-tight">{v}</div>
          {sub && <div className="mt-1.5 text-[13px] text-[#b3b3b3]">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ episodes

function EpisodeChecklist({ d }: { d: ShowDetail }) {
  // open on the first season you didn't finish (or the last one you touched)
  // when most of what you watched couldn't be placed on TMDB's list (e.g. One Piece's arcs), open on that list
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
  const label = (s: Season) => `Season ${s.season}`;
  return (
    <Section title="Episodes" subtitle="Every episode out, and which ones you watched"
             action={
               <div className="relative">
                 <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="nf-select">
                   {current ? label(current) : "Other episodes"} <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                 </button>
                 {open && (
                   <div className="nf-menu absolute right-0 top-full z-30 mt-1 max-h-[340px] w-64 overflow-y-auto py-1">
                     {d.seasons.map((s) => (
                       <button key={s.season} onClick={() => { setSeason(s.season); setOpen(false); }}
                               className={`flex w-full items-center justify-between px-4 py-2 text-left text-[14px] hover:bg-white/10 ${s.season === season ? "font-bold" : "text-[#e5e5e5]"}`}>
                         {label(s)} <span className="text-[12px] text-[#b3b3b3]">{num(s.watched)}/{num(s.aired)}</span>
                       </button>
                     ))}
                     {d.other_episodes.length > 0 && (
                       <button onClick={() => { setSeason("other"); setOpen(false); }}
                               className={`flex w-full items-center justify-between border-t border-white/15 px-4 py-2 text-left text-[14px] hover:bg-white/10 ${season === "other" ? "font-bold" : "text-[#e5e5e5]"}`}>
                         Other episodes <span className="text-[12px] text-[#b3b3b3]">{num(d.other_episodes.length)}</span>
                       </button>
                     )}
                   </div>
                 )}
               </div>
             }>
      {/* season overview strip: one bar per season */}
      {d.seasons.length > 1 && (
        <div className="mb-5 flex gap-1" aria-label="Seasons watched">
          {d.seasons.map((s) => (
            <button key={s.season} onClick={() => setSeason(s.season)} title={`${label(s)}: ${s.watched} of ${s.aired}`}
                    className={`group flex-1 pt-1 ${s.season === season ? "" : "opacity-70 hover:opacity-100"}`}>
              <div className="h-1.5 bg-[#404040]">
                <div className="h-full" style={{ width: `${s.aired ? (s.watched / s.aired) * 100 : 0}%`, background: s.watched >= s.aired && s.aired ? GREEN : RED }} />
              </div>
              <div className={`mt-1 text-[11px] ${s.season === season ? "font-bold text-white" : "text-[#808080]"}`}>S{s.season}</div>
            </button>
          ))}
        </div>
      )}
      {current ? (
        <ol className="flex flex-col">
          {current.episodes.map((e) => <EpisodeRow key={e.number} e={e} />)}
        </ol>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-[#808080]">Episodes not matched to a full episode list (some seasons go by a different name).</p>
          <ol className="flex flex-col">
            {d.other_episodes.map((e, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-white/[0.08] py-3">
                <Check size={18} className="shrink-0" style={{ color: GREEN }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{e.title ?? "Episode"}</div>
                  {e.season && <div className="text-[13px] text-[#b3b3b3]">{e.season}</div>}
                </div>
                <div className="shrink-0 text-right text-[13px] text-[#b3b3b3]">{date(e.first)}{e.times > 1 && <span className="block">{e.times}× watched</span>}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  const dim = !e.watched;
  return (
    <li className={`flex items-center gap-4 border-b border-white/[0.08] py-3 ${dim ? "opacity-45" : ""}`}>
      <span className="w-7 shrink-0 text-center text-[22px] font-bold text-[#d2d2d2]">{e.number}</span>
      <div className="relative hidden aspect-video w-[130px] shrink-0 overflow-hidden rounded-[4px] bg-[#2f2f2f] sm:block">
        {e.still && <img src={e.still} alt="" loading="lazy" className={`h-full w-full object-cover ${dim ? "grayscale" : ""}`} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[15px] font-bold">{e.name ?? `Episode ${e.number}`}</span>
          {e.runtime_min && <span className="shrink-0 text-[13px] text-[#b3b3b3]">{e.runtime_min}m</span>}
        </div>
        <div className="mt-1 text-[13px]">
          {e.watched
            ? <span style={{ color: GREEN }} className="inline-flex items-center gap-1 font-bold"><Check size={14} /> Watched {date(e.first!)}{e.times > 1 && <span className="font-medium text-[#b3b3b3]"> · {e.times}×</span>}</span>
            : <span className="text-[#b3b3b3]">{e.aired ? "Not watched" : `Airs ${e.air_date ? date(e.air_date) : "later"}`}</span>}
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ similar

function Similar({ items, genres }: { items: ShowDetail["similar"]; genres: string[] }) {
  const q = useLinkQuery();
  return (
    <Section title="Your other shows like this" subtitle={`Sharing its genres: ${genres.slice(0, 3).join(", ")}`}>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
        {items.map((s) => (
          <Link key={s.key} to={`/channel/${s.key}` + q} className="group min-w-0">
            <div className="overflow-hidden rounded-[4px] bg-[#2f2f2f]">
              {s.poster && <img src={s.poster.replace("/w185/", "/w342/")} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover transition-transform group-hover:scale-[1.04]" />}
            </div>
            <div className="mt-2 truncate text-[13px] font-bold">{s.title}</div>
            <div className="text-[12px] text-[#b3b3b3]">{num(s.count)} eps</div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

/** Fill months with no watching so gaps show as gaps. */
function fill(data: MonthPoint[]): MonthPoint[] {
  if (!data.length) return data;
  const got = new Map(data.map((m) => [m.month, m]));
  const out: MonthPoint[] = [];
  let [y, m] = data[0].month.split("-").map(Number);
  const [ey, em] = data[data.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(got.get(key) ?? { month: key, count: 0, time_s: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
