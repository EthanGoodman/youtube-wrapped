/* The home page on Crunchyroll: a stats page with Crunchyroll's look (black, #ff640a, square posters,
   uppercase tags, banner art fading to black). */
import { ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, Sparkle } from "@phosphor-icons/react";
import { MonthPoint, Overview, TopResponse, useStats } from "../api";
import { Link } from "../platform";
import { QueryState, Section, SeeAll } from "../components/ui";
import { BarList } from "../components/lists";
import { MeasureToggle, MonthlyBars, useMeasure } from "../components/charts";
import { ShowProgress, ShowStatus, useShows } from "../components/shows";
import { Bar, CRShow, Meta, ORANGE, PosterCard, PosterImg, STATUS, TEAL, Tag } from "../components/cr";
import { date, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

interface HomeShow extends CRShow { backdrop: string | null; year: string | null; first_watched?: string; last_watched?: string | null }
interface HomeData { billboard: HomeShow | null; top10: HomeShow[]; finished: HomeShow[]; new: HomeShow[] }
interface Anime {
  sub: { count: number; time_s: number }; dub: { count: number; time_s: number };
  simulcast: number; dated: number; median_days_after_air: number | null;
  simulcast_shows: { key: string; title: string; avatar_url: string | null; episodes: number }[];
}

const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : `${Math.round(s / 60)}m`);

export function CrunchyrollHome() {
  const home = useShows<HomeData>("home");
  const { filters, update } = useFilters();
  const genres = useStats<TopResponse>("top/genres", { limit: 8 });
  const monthly = useStats<{ data: MonthPoint[] }>("patterns/monthly");
  const [measure, setMeasure] = useMeasure();
  const data = home.data?.data;
  return (
    <div className="flex flex-col gap-12">
      <Hero billboard={data?.billboard ?? null} />

      <Section title="Your Top 10 series" subtitle={`By ${filters.metric === "time" ? "watch time" : "episodes"}, ${rangeLabel(filters)}`}
               action={<>
                 <div className="seg" role="group" aria-label="Rank by">
                   <button aria-pressed={filters.metric === "count"} onClick={() => update({ metric: "count" })}>Episodes</button>
                   <button aria-pressed={filters.metric === "time"} onClick={() => update({ metric: "time" })}>Time</button>
                 </div>
                 <SeeAll to="/top/channels" />
               </>}>
        <QueryState q={home} minHeight={320} empty={(d) => !d.data.top10.length}>
          {(d) => (
            <Row>{d.data.top10.map((s) => <PosterCard key={s.key} s={s} className="w-[150px] shrink-0 sm:w-[176px]" />)}</Row>
          )}
        </QueryState>
      </Section>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3"><ProgressList /></div>
        <div className="min-w-0 lg:col-span-2"><AnimeGlance /></div>
      </div>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
        <Section title="Top genres" subtitle={rangeLabel(filters)} action={<SeeAll to="/top/genres" />} className="lg:col-span-2">
          <QueryState q={genres} minHeight={260} empty={(d) => !d.items.length}>
            {(d) => <BarList items={d.items} metric={filters.metric} linkTo={(g) => `/genre/${encodeURIComponent(g.key)}`} />}
          </QueryState>
        </Section>
        <Section title="Month by month" subtitle={measure === "time" ? "Hours watched per month" : "Episodes per month"}
                 action={<MeasureToggle value={measure} onChange={setMeasure} />} className="lg:col-span-3">
          <QueryState q={monthly} minHeight={260} empty={(d) => !d.data.length}>
            {(d) => <MonthlyBars data={d.data} measure={measure} />}
          </QueryState>
        </Section>
      </div>

      {data && data.new.length > 0 && (
        <Section title="New to you" subtitle={`Series you started, ${rangeLabel(filters)}`}>
          <Row>
            {data.new.map((s) => (
              <PosterCard key={s.key} s={s} className="w-[132px] shrink-0 sm:w-[150px]"
                          line={<Meta items={[`since ${date(s.first_watched!)}`, `${num(s.count)} eps`]} />} />
            ))}
          </Row>
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ hero: your numbers over the #1 series' banner

function Hero({ billboard }: { billboard: HomeShow | null }) {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const ov = useStats<Overview>("overview");
  const anime = useShows<Anime>("anime");
  const o = ov.data;
  const a = anime.data?.data;
  const watched = a ? a.sub.count + a.dub.count : 0;
  const kicker = /^\d{4}$/.test(filters.range) ? `Your ${filters.range} on Crunchyroll`
    : filters.range === "all" ? "Your Crunchyroll, all time" : `Your Crunchyroll · ${rangeLabel(filters).replace(/^the /, "")}`;
  return (
    <section className="relative -mt-[124px] ml-[calc(50%-50vw)] w-screen overflow-hidden md:-mt-[144px] xl:-mt-[100px]">
      {billboard?.backdrop && <img src={billboard.backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-60" />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #000 6%, rgba(0,0,0,.82) 42%, rgba(0,0,0,.2) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, #0000 45%, #000 92%)" }} />
      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-8 px-[4%] pb-12 pt-[164px] md:flex-row md:items-end md:pt-[190px] xl:pt-[150px]">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#bbb]">{kicker}</p>
          {o ? (
            <>
              <div className="mt-3 flex items-end gap-3">
                <span className="cr-display text-[clamp(76px,10vw,150px)] font-extrabold leading-[0.85]" style={{ color: ORANGE }}>
                  {num(Math.round(o.est_s / 3600))}
                </span>
                <span className="cr-display pb-1 text-[clamp(20px,2vw,30px)] font-extrabold uppercase leading-tight">
                  hours<span className="block font-sans text-[12px] font-medium normal-case tracking-normal text-[#8c8c8c]">actually watched</span>
                </span>
              </div>
              <div className="mt-[clamp(32px,3.4vw,52px)] flex flex-wrap gap-x-9 gap-y-3">
                <Figure value={num(o.videos)} label="episodes" />
                <Figure value={num(o.unique_channels)} label="series" />
                <Figure value={num(o.active_days)} label={`of ${num(o.days)} days`} />
                {a && watched > 0 && <Figure value={pct(a.sub.count / watched)} label="subbed" />}
              </div>
            </>
          ) : <div className="h-[220px]" />}
          {a && watched > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-1.5">
              <Tag tone="orange">{pct(a.sub.count / watched)} sub</Tag>
              <Tag tone="teal">{pct(a.dub.count / watched)} dub</Tag>
              {a.simulcast > 0 && <Tag tone="light">{num(a.simulcast)} simulcast</Tag>}
            </div>
          )}
          <Link to={"/wrapped" + q} className="btn-secondary mt-8"><Sparkle size={18} weight="fill" /> Open your Wrapped</Link>
        </div>
        {billboard && (
          <Link to={`/channel/${billboard.key}` + q} className="group flex shrink-0 items-end gap-4">
            <div className="w-[96px] md:w-[124px]"><PosterImg src={billboard.poster} /></div>
            <div className="pb-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#bbb]">Your #1 series</p>
              <p className="cr-display mt-1 max-w-[280px] text-[24px] font-extrabold leading-tight group-hover:text-[#ff7b2e]">{billboard.title}</p>
              <Meta className="mt-1.5" items={[`${num(billboard.count)} eps`, hours(billboard.time_s), billboard.studios?.[0]]} />
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
      <div className="cr-display text-[clamp(26px,2.5vw,38px)] font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-[12px] font-medium uppercase tracking-[0.06em] text-[#8c8c8c]">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------ progress + anime at a glance

function ProgressList() {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const prog = useShows<{ shows: ShowProgress[] }>("progress", { limit: 8 });
  return (
    <Section title="How far you got" subtitle={`Series ${rangeLabel(filters)}, against every episode out`} action={<SeeAll to="/shows" />}>
      <QueryState q={prog} minHeight={300} empty={(d) => !d.data.shows.length}>
        {(d) => (
          <ul className="flex flex-col gap-1">
            {d.data.shows.map((s) => (
              <li key={s.key}>
                <Link to={`/channel/${s.key}${q}`} className="-mx-3 flex items-center gap-4 px-3 py-2.5 transition-colors duration-150 hover:bg-[#151515]">
                  <div className="w-11 shrink-0"><PosterImg src={s.avatar_url} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[15px] font-bold">{s.title}</span>
                      <StatusTag status={s.status} />
                    </div>
                    <Bar pct={s.pct} status={s.status} className="mt-2" />
                    <div className="mt-1.5 flex justify-between text-[12px] text-[#8c8c8c]">
                      <span>{s.total != null ? `${num(s.watched)} of ${num(s.total)} episodes` : `${num(s.watched)} episodes`}</span>
                      {s.pct != null && <span className="font-bold text-white">{Math.round(s.pct * 100)}%</span>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}

function StatusTag({ status }: { status: ShowStatus }) {
  return <Tag tone={status === "finished" ? "teal" : status === "watching" ? "orange" : "dark"}>{STATUS[status].label}</Tag>;
}

function AnimeGlance() {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const anime = useShows<Anime>("anime");
  const prog = useShows<{ summary: Record<ShowStatus, number> }>("progress", { limit: 1 });
  const a = anime.data?.data;
  const s = prog.data?.data.summary;
  const total = a ? a.sub.time_s + a.dub.time_s : 0;
  return (
    <Section title="At a glance" subtitle={rangeLabel(filters)}>
      <div className="flex flex-col gap-8">
        {s && (
          <div className="grid grid-cols-3 gap-px bg-[#272727]">
            {(["finished", "watching", "dropped"] as ShowStatus[]).map((k) => (
              <div key={k} className="bg-black px-4 py-4">
                <div className="cr-display text-[40px] font-extrabold leading-none" style={{ color: STATUS[k].color }}>{num(s[k])}</div>
                <div className="mt-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-[#8c8c8c]">{STATUS[k].label}</div>
              </div>
            ))}
          </div>
        )}
        {a && total > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-bold uppercase tracking-[0.06em]">Sub or dub</span>
              <span className="text-[12px] text-[#8c8c8c]">by watch time</span>
            </div>
            <div className="flex h-2 gap-0.5" role="img" aria-label={`Subbed ${pct(a.sub.time_s / total)}, dubbed ${pct(a.dub.time_s / total)}`}>
              <div style={{ width: `${(a.sub.time_s / total) * 100}%`, background: ORANGE }} />
              <div style={{ width: `${(a.dub.time_s / total) * 100}%`, background: TEAL }} />
            </div>
            <div className="mt-2 flex justify-between text-[12px] text-[#bbb]">
              <span><b className="text-white">{pct(a.sub.time_s / total)}</b> subbed · {num(a.sub.count)} eps</span>
              <span><b className="text-white">{pct(a.dub.time_s / total)}</b> dubbed · {num(a.dub.count)} eps</span>
            </div>
          </div>
        )}
        {a && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-bold uppercase tracking-[0.06em]">Simulcast</span>
              <span className="text-[12px] text-[#8c8c8c]">within a week of airing</span>
            </div>
            <div className="mt-2 flex items-end gap-3">
              <span className="cr-display text-[40px] font-extrabold leading-none" style={{ color: ORANGE }}>{num(a.simulcast)}</span>
              <span className="pb-1 text-[13px] text-[#bbb]">episodes{a.median_days_after_air != null && <> · usually {num(Math.round(a.median_days_after_air / 365 * 10) / 10)} years after airing</>}</span>
            </div>
            {a.simulcast_shows.length > 0 && (
              <div className="mt-3 flex gap-2">
                {a.simulcast_shows.map((x) => (
                  <Link key={x.key} to={`/channel/${x.key}${q}`} className="w-14" title={`${x.title} · ${x.episodes} simulcast`}>
                    <PosterImg src={x.avatar_url} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ row

/** Sideways row with square arrow tiles on hover (Crunchyroll's carousel arrows). */
function Row({ children }: { children: ReactNode }) {
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
      {/* padding leaves room for the hover panel's 8px ring */}
      <div ref={ref} onScroll={measure} className="no-scrollbar -mx-[4%] flex gap-5 overflow-x-auto scroll-smooth px-[4%] py-2">{children}</div>
      {edges.left && <Arrow side="left" onClick={() => go(-1)} />}
      {edges.right && <Arrow side="right" onClick={() => go(1)} />}
    </div>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? CaretLeft : CaretRight;
  return (
    <button onClick={onClick} aria-label={side === "left" ? "Scroll back" : "Scroll on"}
            className={`absolute top-2 hidden h-[calc(100%-1rem)] w-12 items-center justify-center bg-[#414141cc] opacity-0 transition-opacity duration-150 hover:bg-[#414141] group-hover/row:opacity-100 md:flex ${side === "left" ? "-left-[4%]" : "-right-[4%]"}`}>
      <Icon size={32} weight="fill" />
    </button>
  );
}
