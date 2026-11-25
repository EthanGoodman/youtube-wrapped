/* A show's own page in the shared look: a dark header with the poster and how far you got, your pace as a row of
   numbers, every episode season by season (watched or not), when you watched it, and your other shows like it. */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "../platform";
import { MonthPoint, useStats } from "../api";
import { useLinkQuery } from "../filters";
import { date, num } from "../format";
import { ShowProgress } from "../families/shows/data";
import { OV, Poster, Seg, Skeleton, StatsFrame, kicker, useCreator } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { STATUS, StatusPill } from "./ShowsOverviewPage";
import { hoursShort } from "./takeaways";

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

const eps = (n: number) => `${num(n)} episode${n === 1 ? "" : "s"}`;
const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);

export function ShowDetailPage() {
  const { id = "" } = useParams();
  const d = useStats<ShowDetail>(`show/${encodeURIComponent(id)}`);
  const monthly = useStats<{ monthly: MonthPoint[] }>(`channel/${encodeURIComponent(id)}`);
  const s = d.data;
  const cr = useCreator();
  return (
    <StatsFrame>
      {d.error ? <p className="mx-auto max-w-[1400px] p-8">This {cr.one} isn't in your history.</p> : !s ? (
        <div className="mx-auto max-w-[1400px] p-8"><Skeleton h={420} /></div>
      ) : (
        <>
          <Header d={s} />
          <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 pb-16 pt-10 sm:px-8">
            <Pace d={s} />
            {(s.seasons.length > 0 || s.other_episodes.length > 0) && <Episodes d={s} />}
            <Card label="When you watched it · all time" title={s.pace.first ? (s.pace.first === s.pace.last ? `All on ${date(s.pace.first)}` : `${date(s.pace.first)} to ${date(s.pace.last!)}`) : "When you watched it"}>
              {!monthly.data ? <Skeleton h={160} /> : <Months data={fill(monthly.data.monthly)} />}
            </Card>
            {s.similar.length > 0 && <Similar items={s.similar} genres={s.show.genres} />}
          </main>
        </>
      )}
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ header

function Header({ d }: { d: ShowDetail }) {
  const p = d.progress;
  const show = d.show;
  const facts = [show.year, show.seasons ? `${show.seasons} season${show.seasons === 1 ? "" : "s"}` : null, show.genres.slice(0, 3).join(" · ") || null].filter(Boolean);
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      {show.backdrop && (
        <img src={show.backdrop} alt="" aria-hidden referrerPolicy="no-referrer" className="absolute inset-y-0 right-0 h-full w-full object-cover lg:w-[70%]"
             style={{ filter: "grayscale(1) contrast(1.15)", mixBlendMode: "luminosity", opacity: 0.35 }} />
      )}
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${OV.ink} 0%, ${OV.ink}ee 40%, ${OV.ink}77 75%, ${OV.ink}44 100%)` }} />
      <div className="relative mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-10 sm:px-8 md:flex-row md:items-center">
        <Poster src={show.poster} name={show.title} width="clamp(120px,14vw,200px)" ring={OV.paper} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <span className={kicker} style={{ color: OV.mustard }}>{facts.join("  ·  ") || "Show"}</span>
          <h1 className="font-ov-display text-[clamp(36px,5vw,68px)] font-extrabold leading-[0.98] tracking-[-0.02em]">{show.title}</h1>
          {show.overview && <p className="line-clamp-3 max-w-[680px] text-[16px] leading-snug" style={{ color: OV.mute }}>{show.overview}</p>}
          <dl className="grid max-w-[720px] grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat v={num(d.episodes_watched)} l={p?.total ? `of ${num(p.total)} episodes` : "episodes watched"} accent />
            <Stat v={hoursShort(d.time_s)} l="watched (estimated)" />
            <Stat v={num(d.pace.days)} l={d.pace.days === 1 ? "day with it" : "days with it"} />
            {d.views > d.episodes_watched && <Stat v={num(d.views - d.episodes_watched)} l="rewatched" />}
          </dl>
          {p && (
            <div className="flex max-w-[560px] flex-col gap-1.5">
              <span className="flex items-center justify-between gap-3">
                <StatusPill status={p.status} />
                {p.pct != null && <span className="font-ov-display text-[18px] font-extrabold">{Math.round(p.pct * 100)}%</span>}
              </span>
              <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: "#4A433B" }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (p.pct ?? 0) * 100)}%`, background: p.status === "dropped" ? OV.mute : STATUS[p.status].bar }} />
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ v, l, accent = false }: { v: string; l: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{l}</dt>
      <dd className="order-1 font-ov-display text-[30px] font-extrabold leading-tight" style={accent ? { color: OV.mustard } : undefined}>{v}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ pace

function Pace({ d }: { d: ShowDetail }) {
  const f = d.pace.fastest_season;
  const done = d.seasons.filter((s) => s.aired && s.watched >= s.aired).length;
  const items: [string, string, string][] = [
    ["Fastest season", f ? days(f.days) : "–", f ? `Season ${f.season}, ${eps(f.episodes)}` : "no season watched within 30 days"],
    ["Most in one day", d.pace.best_day ? eps(d.pace.best_day.episodes) : "–", d.pace.best_day ? date(d.pace.best_day.date) : ""],
    ["On days you watched", `${num(Math.round(d.pace.per_day * 10) / 10)} a day`, `over ${days(d.pace.days)}`],
    ["Seasons done", d.seasons.length ? `${num(done)} of ${num(d.seasons.length)}` : "–",
     d.pace.seasons_binged.length ? `${num(d.pace.seasons_binged.length)} in under a month` : ""],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([l, v, hint], i) => (
        <div key={l} className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3" style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>
          <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: i === 0 ? OV.ink : OV.soft }}>{l}</dt>
          <dd className="m-0 font-ov-display text-[26px] font-extrabold leading-tight">{v}</dd>
          {hint && <dd className="m-0 text-[13px]" style={{ color: i === 0 ? OV.ink : OV.soft }}>{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ episodes

function Episodes({ d }: { d: ShowDetail }) {
  // open on the first season you didn't finish (or the last one you touched); when most of what you watched couldn't
  // be placed on the episode list (shows that go by arcs), open on that list
  const start = useMemo<string>(() => {
    const placed = d.seasons.reduce((n, s) => n + s.watched, 0);
    if (!d.seasons.length || d.other_episodes.length > placed) return "other";
    const unfinished = d.seasons.find((s) => s.watched > 0 && s.watched < s.aired);
    return String(unfinished?.season ?? [...d.seasons].reverse().find((s) => s.watched > 0)?.season ?? d.seasons[0].season);
  }, [d.seasons, d.other_episodes.length]);
  const [pick, setPick] = useState(start);
  useEffect(() => setPick(start), [start]);
  const current = d.seasons.find((s) => String(s.season) === pick);
  const options: [string, string][] = [
    ...d.seasons.map((s) => [String(s.season), `S${s.season} · ${s.watched}/${s.aired}`] as [string, string]),
    ...(d.other_episodes.length ? [["other", `Other · ${d.other_episodes.length}`] as [string, string]] : []),
  ];
  return (
    <Card label="Episodes · every one out, and which you watched" title={current ? `Season ${current.season}: ${num(current.watched)} of ${num(current.aired)} watched` : "Other episodes"}>
      {d.seasons.length > 1 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(d.seasons.length, 25)},minmax(0,1fr))` }} aria-label="Seasons watched">
          {d.seasons.slice(0, 25).map((s) => {
            const share = s.aired ? s.watched / s.aired : 0;
            return (
              <button key={s.season} type="button" onClick={() => setPick(String(s.season))} title={`Season ${s.season}: ${s.watched} of ${s.aired}`}
                      className="flex flex-col gap-1 text-left transition-opacity" style={{ opacity: String(s.season) === pick ? 1 : 0.6 }}>
                <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: OV.sand }}>
                  <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: share >= 1 ? OV.teal : OV.mustard }} />
                </span>
                <span className="font-shelf-mono text-[11px]" style={{ fontWeight: String(s.season) === pick ? 700 : 400 }}>S{s.season}</span>
              </button>
            );
          })}
        </div>
      )}
      {options.length > 1 && (d.other_episodes.length > 0 || d.seasons.length > 25 || d.seasons.length === 1) && <div className="no-scrollbar -mx-1 overflow-x-auto px-1"><Seg label="Season" value={pick} options={options} onChange={setPick} /></div>}
      {current ? (
        <ol className="flex flex-col">{current.episodes.map((e) => <EpisodeRow key={e.number} e={e} />)}</ol>
      ) : (
        <>
          <p className="text-[14px]" style={{ color: OV.soft }}>Episodes not matched to the episode list (some seasons go by a different name).</p>
          <ol className="flex flex-col">
            {d.other_episodes.map((e, i) => (
              <li key={i} className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: "#E0D5C1" }}>
                <Tick on />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-bold">{e.title ?? "Episode"}</span>
                  {e.season && <span className="text-[12px]" style={{ color: OV.soft }}>{e.season}</span>}
                </span>
                <span className="shrink-0 text-right font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{date(e.first)}{e.times > 1 ? ` · ${e.times}×` : ""}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold"
          style={{ borderColor: OV.ink, background: on ? OV.teal : "transparent", color: OV.paper }}>{on ? "✓" : ""}</span>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  return (
    <li className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: "#E0D5C1", opacity: e.watched ? 1 : 0.55 }}>
      <Tick on={e.watched} />
      <span className="w-7 shrink-0 text-right font-ov-display text-[16px] font-extrabold">{e.number}</span>
      {e.still
        ? <img src={e.still} alt="" loading="lazy" referrerPolicy="no-referrer" className="hidden aspect-video w-[112px] shrink-0 rounded-md border-2 object-cover sm:block"
               style={{ borderColor: OV.ink, filter: e.watched ? undefined : "grayscale(1)" }} />
        : <span className="hidden aspect-video w-[112px] shrink-0 rounded-md border-2 sm:block" style={{ borderColor: OV.ink, background: OV.sand }} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{e.name ?? `Episode ${e.number}`}</span>
        <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
          {e.watched ? `Watched ${date(e.first!)}${e.times > 1 ? ` · ${e.times}×` : ""}` : e.aired ? "Not watched" : `Airs ${e.air_date ? date(e.air_date) : "later"}`}
        </span>
      </span>
      {e.runtime_min && <span className="shrink-0 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{e.runtime_min} min</span>}
    </li>
  );
}

// ------------------------------------------------------------------ when, and similar

function Months({ data }: { data: MonthPoint[] }) {
  if (!data.length) return <p style={{ color: OV.soft }}>No watches.</p>;
  const many = data.length > 24;
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <HoverBars height={150} gap={2} radius={2} hint="Hover a month to see it." ariaLabel="Episodes per month"
               bars={data.map((x) => ({ key: x.month, label: label(x.month), value: x.count, display: `${eps(x.count)} · ${hoursShort(x.time_s)}`, color: OV.ink }))}
               ticks={<Ticks labels={data.map((x) => (many ? (x.month.endsWith("-01") ? x.month.slice(0, 4) : "")
                                                    : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })))} />} />
  );
}

function Similar({ items, genres }: { items: ShowDetail["similar"]; genres: string[] }) {
  const q = useLinkQuery();
  const cr = useCreator();
  return (
    <Card label={`Sharing its genres · ${genres.slice(0, 3).join(", ")}`} title={`Your other ${cr.many} like this`}>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-10">
        {items.map((s) => (
          <li key={s.key} className="min-w-0">
            <Link to={`/channel/${encodeURIComponent(s.key)}${q}`} className="group flex flex-col gap-1.5">
              <Poster src={s.poster} name={s.title} width="100%" className="transition-transform group-hover:-translate-y-0.5" />
              <span className="truncate text-[13px] font-bold group-hover:underline">{s.title}</span>
              <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{eps(s.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
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
