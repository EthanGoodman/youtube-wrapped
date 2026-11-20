/* The home page on Netflix: a stats page with Netflix's mood (dark, cinematic backdrops, red accents,
   bold type, posters, outlined Top 10 numbers). Nothing here pretends you can watch something. */
import { Fragment, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { MonthPoint, Overview, TopResponse, useStats } from "../api";
import { Link } from "../platform";
import { QueryState, Section, SeeAll } from "../components/ui";
import { BarList } from "../components/lists";
import { MeasureToggle, MonthlyBars, useMeasure } from "../components/charts";
import { KindSplit, ShowProgress, ShowStatus, useShows } from "../components/shows";
import { date, duration, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

export interface HomeItem {
  key: string;
  kind: "show" | "movie";
  title: string;
  poster: string | null;
  backdrop: string | null;
  year: string | null;
  seasons?: number | null;
  genres: string[];
  count: number;
  time_s: number;
  watched?: number | null;
  total?: number | null;
  pct?: number | null;
  status?: ShowStatus | null;
  last_watched?: string | null;
  first_watched?: string;
  runtime_s?: number | null;
  rank?: number;
}
interface HomeData { billboard: HomeItem | null; top10: HomeItem[]; finished: HomeItem[]; movies: HomeItem[]; new: HomeItem[] }

const RED = "#e50914";
const STATUS: Record<ShowStatus, string> = { finished: "Finished", watching: "Watching", dropped: "Dropped" };
const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : duration(s));
const big = (s: string) => s.replace("/w185/", "/w342/");

export function NetflixHome() {
  const home = useShows<HomeData>("home");
  const { filters, update } = useFilters();
  const genres = useStats<TopResponse>("top/genres", { limit: 8 });
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const [measure, setMeasure] = useMeasure();
  return (
    <div className="flex flex-col gap-10 md:gap-12">
      <Hero billboard={home.data?.data.billboard ?? null} />

      <QueryState q={home} minHeight={260} empty={(d) => !d.data.top10.length}>
        {({ data }) => (
          <Section title="Your Top 10 shows" subtitle={`By ${filters.metric === "time" ? "watch time" : "episodes"}, from ${rangeLabel(filters)}`}
                   action={<><Toggle value={filters.metric} onChange={(m) => update({ metric: m })} /><SeeAll to="/top/channels" /></>}>
            <Scroller>{data.top10.map((it) => <Top10Tile key={it.key} it={it} />)}</Scroller>
          </Section>
        )}
      </QueryState>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:gap-12">
        <div className="min-w-0 lg:col-span-3"><ProgressPanel /></div>
        <div className="min-w-0 lg:col-span-2"><FinishedPanel finished={home.data?.data.finished ?? []} /></div>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:gap-12">
        <Section title="Top genres" subtitle={`From ${rangeLabel(filters)}`} action={<SeeAll to="/top/genres" />} className="lg:col-span-2">
          <QueryState q={genres} minHeight={260} empty={(d) => !d.items.length}>
            {(d) => <BarList items={d.items} metric={filters.metric} linkTo={(g) => `/genre/${encodeURIComponent(g.key)}`} />}
          </QueryState>
        </Section>
        <Section title="Month by month" subtitle={measure === "time" ? "Estimated hours per month" : "Titles per month"}
                 action={<MeasureToggle value={measure} onChange={setMeasure} />} className="lg:col-span-3">
          <QueryState q={monthly} minHeight={260} empty={(d) => !d.data.length}>
            {(d) => <MonthlyBars data={d.data} measure={measure} />}
          </QueryState>
        </Section>
      </div>

      <QueryState q={home} minHeight={120}>
        {({ data }) => (
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-12">
            {data.movies.length > 0 && (
              <Section title="Movies" subtitle={`Your most watched, from ${rangeLabel(filters)}`} action={<SeeAll to="/top/movies" />}>
                <MovieList items={data.movies} />
              </Section>
            )}
            {data.new.length > 0 && (
              <Section title="New to you" subtitle={`Shows you started for the first time, from ${rangeLabel(filters)}`}>
                <Scroller>{data.new.map((it) => <PosterStat key={it.key} it={it} line={`since ${date(it.first_watched!)}`} />)}</Scroller>
              </Section>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ header: the numbers, over your #1 show

function Hero({ billboard }: { billboard: HomeItem | null }) {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const ov = useStats<Overview>("overview");
  const split = useShows<KindSplit>("split");
  const o = ov.data;
  const kicker = /^\d{4}$/.test(filters.range) ? `Your ${filters.range} on Netflix`
    : filters.range === "all" ? "Your Netflix, all time" : `Your Netflix · ${rangeLabel(filters).replace(/^the /, "")}`;
  const s = split.data?.data;
  const total = s ? s.episode.est_s + s.movie.est_s : 0;
  return (
    <section className="relative -mt-[104px] ml-[calc(50%-50vw)] w-screen overflow-hidden md:-mt-[92px]">
      {billboard?.backdrop && (
        <img src={billboard.backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-45" />
      )}
      {/* cinematic fade: dark on the left behind the numbers, into the page at the bottom */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #141414 8%, rgba(20,20,20,.78) 45%, rgba(20,20,20,.3) 100%)" }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: "linear-gradient(180deg, transparent, #141414)" }} />
      <div className="absolute inset-x-0 top-0 h-32" style={{ background: "linear-gradient(0deg, transparent, rgba(0,0,0,.6))" }} />

      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-8 px-[4%] pb-10 pt-[124px] md:flex-row md:items-end md:pb-14 md:pt-[150px]">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold uppercase tracking-[0.25em] text-[#e5e5e5] md:text-[15px]">{kicker}</p>
          {o ? (
            <>
              <div className="mt-3 flex items-end gap-3">
                <span className="text-[clamp(72px,10vw,150px)] font-black leading-[0.82] tracking-[-0.05em]" style={{ color: RED }}>
                  {num(Math.round(o.est_s / 3600))}
                </span>
                <span className="pb-1 text-[clamp(18px,2vw,30px)] font-extrabold uppercase leading-tight tracking-tight">
                  hours<span className="block text-[12px] font-medium normal-case tracking-normal text-[#b3b3b3]">estimated</span>
                </span>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
                <Figure value={num(o.videos)} label="titles" />
                <Figure value={num(o.unique_channels)} label="shows" />
                <Figure value={num(o.active_days)} label={`of ${num(o.days)} days`} />
                <Figure value={pct(o.pct_days_active)} label="of days watched" />
              </div>
            </>
          ) : <div className="h-[220px]" />}
          {s && total > 0 && (
            <div className="mt-7 max-w-[560px]">
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-sm" role="img"
                   aria-label={`Shows ${pct(s.episode.est_s / total)}, movies ${pct(s.movie.est_s / total)} of watch time`}>
                <div style={{ width: `${(s.episode.est_s / total) * 100}%`, background: RED }} />
                <div className="bg-[#808080]" style={{ width: `${(s.movie.est_s / total) * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between gap-4 text-[13px] text-[#b3b3b3]">
                <span><b className="text-white">{pct(s.episode.est_s / total)}</b> shows · {num(s.episode.count)} episodes</span>
                <span><b className="text-white">{pct(s.movie.est_s / total)}</b> movies · {num(s.movie.count)}</span>
              </div>
            </div>
          )}
          <Link to={"/wrapped" + q} className="mt-8 inline-flex items-center gap-2 rounded-[4px] border border-white/60 px-4 py-2 text-[14px] font-bold transition-colors hover:bg-white/10">
            <Sparkles size={17} /> Open your Wrapped
          </Link>
        </div>
        {billboard && (
          <Link to={`/channel/${billboard.key}` + q} className="group flex shrink-0 items-end gap-4 md:mb-1">
            {billboard.poster && <img src={big(billboard.poster)} alt="" className="w-[92px] rounded-[4px] shadow-[0_8px_30px_rgba(0,0,0,.6)] md:w-[120px]" />}
            <div className="pb-1">
              <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#b3b3b3]">Your #1 show</p>
              <p className="mt-1 max-w-[260px] text-[22px] font-black leading-tight group-hover:underline">{billboard.title}</p>
              <p className="mt-1 text-[14px] text-[#e5e5e5]">{num(billboard.count)} episodes · {hours(billboard.time_s)}</p>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[clamp(24px,2.4vw,36px)] font-black leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-[13px] text-[#b3b3b3]">{label}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: "count" | "time"; onChange: (v: "count" | "time") => void }) {
  return (
    <div className="seg" role="group" aria-label="Rank by">
      <button aria-pressed={value === "count"} onClick={() => onChange("count")}>Episodes</button>
      <button aria-pressed={value === "time"} onClick={() => onChange("time")}>Time</button>
    </div>
  );
}

// ------------------------------------------------------------------ Top 10

function Top10Tile({ it }: { it: HomeItem }) {
  const q = useLinkQuery();
  const tip = useStatTip(it);
  return (
    <Link to={`/channel/${it.key}` + q} {...tip.bind} className="flex w-[200px] shrink-0 flex-col sm:w-[230px]">
      <div className="flex items-end">
        <svg viewBox="0 0 100 150" className="w-[50%] shrink-0" aria-hidden>
          <text x={it.rank === 10 ? 52 : 60} y="140" textAnchor="middle" fontSize="150" fontWeight="900" letterSpacing="-14"
                fontFamily="Inter, sans-serif" fill="#141414" stroke="#595959" strokeWidth="4" paintOrder="stroke fill">
            {it.rank}
          </text>
        </svg>
        <div className="relative -ml-[4%] w-[54%] shrink-0 overflow-hidden rounded-[4px] bg-[#2f2f2f]">
          {it.poster && <img src={big(it.poster)} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />}
        </div>
      </div>
      <div className="ml-[46%] mt-2 min-w-0">
        <div className="truncate text-[14px] font-bold">{it.title}</div>
        <div className="text-[13px] text-[#b3b3b3]">{num(it.count)} eps · {hours(it.time_s)}</div>
      </div>
      {tip.card}
    </Link>
  );
}

/** Small stats tooltip on hover (mouse only), drawn in a portal so the scrolling row can't clip it. */
function useStatTip(it: HomeItem) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const bind = {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const el = e.currentTarget;
      timer.current = window.setTimeout(() => setRect(el.getBoundingClientRect()), 350);
    },
    onPointerLeave: () => { window.clearTimeout(timer.current); setRect(null); },
  };
  const card = rect ? createPortal(<StatTip it={it} rect={rect} />, document.body) : null;
  return { bind, card };
}

function StatTip({ it, rect }: { it: HomeItem; rect: DOMRect }) {
  const w = 250;
  const left = Math.min(Math.max(rect.left + rect.width * 0.73 - w / 2, 12), window.innerWidth - w - 12);
  const rows: [string, ReactNode][] = [
    ["Episodes", it.total ? `${num(it.watched ?? it.count)} of ${num(it.total)}` : num(it.count)],
    ["Watch time", hours(it.time_s)],
  ];
  if (it.status) rows.push(["Status", STATUS[it.status]]);
  if (it.last_watched) rows.push(["Last watched", date(it.last_watched)]);
  return (
    <div className="pointer-events-none fixed z-[60] animate-[nf-pop_.18s_cubic-bezier(0.4,0,0.2,1)] rounded-[4px] border border-white/15 bg-[#181818] p-3 shadow-[0_8px_24px_rgba(0,0,0,.7)]"
         style={{ left, top: Math.max(8, rect.top - 150), width: w }}>
      <p className="truncate text-[14px] font-bold">{it.title}</p>
      {it.pct != null && <p className="mt-0.5 text-[13px] font-bold text-[#46d369]">{Math.round(it.pct * 100)}% of the show</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <Fragment key={k}><dt className="text-[#808080]">{k}</dt><dd className="text-right">{v}</dd></Fragment>
        ))}
      </dl>
      {it.genres.length > 0 && <p className="mt-2 truncate text-[12px] text-[#b3b3b3]">{it.genres.slice(0, 3).join(" • ")}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ progress and finished

function ProgressPanel() {
  const { filters } = useFilters();
  const prog = useShows<{ shows: ShowProgress[] }>("progress", { limit: 8 });
  return (
    <Section title="How far you got" subtitle={`Shows from ${rangeLabel(filters)}, against every episode out`} action={<SeeAll to="/shows" />}>
      <QueryState q={prog} minHeight={300} empty={(d) => !d.data.shows.length}>
        {(d) => (
          <ul className="flex flex-col divide-y divide-white/[0.06]">
            {d.data.shows.map((s) => <ProgressRow key={s.key} s={s} />)}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}

function ProgressRow({ s }: { s: ShowProgress }) {
  const q = useLinkQuery();
  const color = s.status === "finished" ? "#46d369" : s.status === "watching" ? RED : "#808080";
  return (
    <li>
      <Link to={`/channel/${s.key}` + q} className="flex items-center gap-4 py-2.5 transition-colors hover:bg-white/[0.04]">
        {s.avatar_url ? <img src={s.avatar_url} alt="" loading="lazy" className="h-[60px] w-10 shrink-0 rounded-[3px] object-cover" />
                      : <span className="h-[60px] w-10 shrink-0 rounded-[3px] bg-[#2f2f2f]" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[15px] font-bold">{s.title}</span>
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{STATUS[s.status]}</span>
          </div>
          <div className="mt-2 h-[3px] bg-[#404040]"><div className="h-full" style={{ width: `${(s.pct ?? 0) * 100}%`, background: color }} /></div>
          <div className="mt-1.5 flex justify-between text-[12px] text-[#b3b3b3]">
            <span>{s.total != null ? `${num(s.watched)} of ${num(s.total)} episodes` : `${num(s.watched)} episodes`}</span>
            {s.pct != null && <span className="font-bold text-white">{Math.round(s.pct * 100)}%</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

function FinishedPanel({ finished }: { finished: HomeItem[] }) {
  const { filters } = useFilters();
  const prog = useShows<{ summary: Record<ShowStatus, number>; shows: ShowProgress[] }>("progress", { limit: 1 });
  const s = prog.data?.data.summary;
  const q = useLinkQuery();
  return (
    <Section title="Finished or not" subtitle={`Every show you watched from ${rangeLabel(filters)}`}>
      {s && (
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[4px] bg-white/[0.06]">
          {([["finished", "#46d369"], ["watching", RED], ["dropped", "#b3b3b3"]] as [ShowStatus, string][]).map(([k, c]) => (
            <div key={k} className="bg-[#181818] px-4 py-4">
              <div className="text-[44px] font-black leading-none tracking-tight" style={{ color: c }}>{num(s[k])}</div>
              <div className="mt-1.5 text-[13px] text-[#b3b3b3]">{STATUS[k]}</div>
            </div>
          ))}
        </div>
      )}
      {finished.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-[12px] font-bold uppercase tracking-[0.18em] text-[#808080]">Seen through to the end</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-5">
            {finished.slice(0, 10).map((f) => (
              <Link key={f.key} to={`/channel/${f.key}` + q} title={`${f.title} · ${num(f.count)} episodes`}
                    className="block overflow-hidden rounded-[3px] bg-[#2f2f2f] transition-transform hover:scale-[1.04]">
                {f.poster && <img src={f.poster} alt={f.title} loading="lazy" className="aspect-[2/3] w-full object-cover" />}
              </Link>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ movies and new shows

function MovieList({ items }: { items: HomeItem[] }) {
  const q = useLinkQuery();
  return (
    <ol className="flex flex-col divide-y divide-white/[0.06]">
      {items.slice(0, 6).map((m) => (
        <li key={m.key}>
          <Link to={`/video/${m.key}` + q} className="flex items-center gap-4 py-2 transition-colors hover:bg-white/[0.04]">
            <span className="w-7 shrink-0 text-center text-[26px] font-black leading-none text-[#595959]">{m.rank}</span>
            {m.poster ? <img src={m.poster} alt="" loading="lazy" className="h-[60px] w-10 shrink-0 rounded-[3px] object-cover" />
                      : <span className="h-[60px] w-10 shrink-0 rounded-[3px] bg-[#2f2f2f]" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">{m.title}</div>
              <div className="text-[13px] text-[#b3b3b3]">{[m.year, m.runtime_s ? duration(m.runtime_s) : null, m.genres[0]].filter(Boolean).join(" · ")}</div>
            </div>
            {m.count > 1 && <span className="shrink-0 text-[13px] font-bold">{m.count}×</span>}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function PosterStat({ it, line }: { it: HomeItem; line: string }) {
  const q = useLinkQuery();
  return (
    <Link to={`/channel/${it.key}` + q} className="w-[118px] shrink-0">
      <div className="overflow-hidden rounded-[4px] bg-[#2f2f2f]">
        {it.poster && <img src={big(it.poster)} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover transition-transform hover:scale-[1.04]" />}
      </div>
      <div className="mt-2 truncate text-[13px] font-bold">{it.title}</div>
      <div className="text-[12px] text-[#b3b3b3]">{num(it.count)} eps · {line}</div>
    </Link>
  );
}

/** Sideways row with ‹ › on hover (wide screens). */
function Scroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  const go = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: "smooth" });
  return (
    <div className="group/row relative">
      <div ref={ref} onScroll={measure} className="no-scrollbar -mx-[4%] flex gap-3 overflow-x-auto scroll-smooth px-[4%]">{children}</div>
      {edges.left && <EdgeArrow side="left" onClick={() => go(-1)} />}
      {edges.right && <EdgeArrow side="right" onClick={() => go(1)} />}
    </div>
  );
}

function EdgeArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button onClick={onClick} aria-label={side === "left" ? "Scroll back" : "Scroll on"}
            className={`absolute top-0 hidden h-full w-12 items-center justify-center bg-[rgba(20,20,20,0.6)] opacity-0 transition-opacity group-hover/row:opacity-100 md:flex ${side === "left" ? "-left-[4%]" : "-right-[4%]"}`}>
      <Icon size={34} />
    </button>
  );
}
