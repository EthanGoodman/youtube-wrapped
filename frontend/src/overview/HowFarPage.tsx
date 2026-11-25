/* "How far you got" (shows family): every show you watched in the period as a poster wall, each with a bar for how much
   of it you saw and whether you finished it, kept going or dropped it. Then your fastest seasons and rewatches. */
import { ReactNode, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "../platform";
import { TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num } from "../format";
import { Binge, ShowProgress, ShowStatus } from "../families/shows/data";
import { OV, PageBody, PageHeader, Poster, Seg, Skeleton, StatsFrame, kicker } from "./kit";
import { STATUS, StatusPill, howFarTitle } from "./ShowsOverviewPage";
import { periodTitle } from "./takeaways";

type Pick = ShowStatus | "all";
type Sort = "watched" | "recent" | "complete" | "az";
const SORTS: [Sort, string][] = [["watched", "Most watched"], ["recent", "Latest"], ["complete", "Most complete"], ["az", "A–Z"]];
type Progressed = { summary: Record<ShowStatus, number>; shows: ShowProgress[] };
type Rewatches = { detectable: boolean; items: TopResponse["items"] };

export function HowFarPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const [params, setParams] = useSearchParams();
  const progress = useStats<{ data: Progressed }>("shows/progress", { limit: 500 });
  const binges = useStats<{ data: Binge[] }>("shows/binges", { limit: 8 });
  const rewatches = useStats<{ data: Rewatches }>("shows/rewatches");
  const pick = (params.get("status") as Pick | null) ?? "all";
  const sort = (params.get("sort") as Sort | null) ?? "watched";
  const set = (k: string, v: string, dflt: string) =>
    setParams((p) => { const n = new URLSearchParams(p); if (v === dflt) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const d = progress.data?.data;

  return (
    <StatsFrame>
      <PageHeader label={`How far you got · ${periodTitle(filters, meta?.today)}`} title={d ? howFarTitle(d.summary) : "How far you got"}>
        {d && (
          <div className="flex flex-wrap items-center gap-3">
            <Seg label="Show" dark value={pick} onChange={(v) => set("status", v, "all")}
                 options={[["all", `All · ${num(d.shows.length)}`], ...(["finished", "watching", "dropped"] as const).map((k) => [k, `${STATUS[k].label} · ${num(d.summary[k])}`] as [Pick, string])]} />
            <span className="ml-2 font-shelf-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: OV.mute }} aria-hidden>Sort</span>
            <Seg label="Sort" dark value={sort} options={SORTS} onChange={(v) => set("sort", v, "watched")} />
          </div>
        )}
        <p className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>
          Finished: up to the latest episode · Still watching: watched in the last 30 days · Dropped: unfinished, 30+ days ago
        </p>
      </PageHeader>
      <PageBody>
        {!d ? <Skeleton h={500} /> : <Wall shows={d.shows} pick={pick} sort={sort} />}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card label="Whole seasons, first episode to last" title="Your fastest seasons">
            {!binges.data ? <Skeleton h={240} /> : !binges.data.data.length ? <p style={{ color: OV.soft }}>No whole season finished in this period.</p> : (
              <ol className="flex flex-col">{binges.data.data.map((b, i) => <BingeRow key={`${b.key}-${b.season}`} b={b} rank={i + 1} />)}</ol>
            )}
          </Card>
          <Card label="Watched again at least a week later" title="Rewatches">
            {!rewatches.data ? <Skeleton h={160} /> : !rewatches.data.data.detectable ? (
              <p className="text-[15px]" style={{ color: OV.soft }}>
                {meta?.platform.id === "netflix"
                  ? "Netflix's quick download lists each title once, so rewatches only show up with the full data export (ViewingActivity.csv)."
                  : `Your ${meta?.platform.name ?? ""} history lists each title once, so rewatches can't be seen.`}
              </p>
            ) : !rewatches.data.data.items.length ? <p style={{ color: OV.soft }}>Nothing rewatched in this period.</p> : (
              <ol className="flex flex-col">{rewatches.data.data.items.slice(0, 10).map((t) => <RewatchRow key={t.key} t={t} />)}</ol>
            )}
          </Card>
        </div>
      </PageBody>
    </StatsFrame>
  );
}

function Wall({ shows, pick, sort }: { shows: ShowProgress[]; pick: Pick; sort: Sort }) {
  const q = useLinkQuery();
  const list = useMemo(() => {
    const by: Record<Sort, (a: ShowProgress, b: ShowProgress) => number> = {
      watched: () => 0,  // the API already ranks them
      recent: (a, b) => b.last_watched.localeCompare(a.last_watched),
      complete: (a, b) => (b.pct ?? 0) - (a.pct ?? 0),
      az: (a, b) => a.title.localeCompare(b.title),
    };
    return shows.filter((s) => pick === "all" || s.status === pick).sort(by[sort]);
  }, [shows, pick, sort]);
  if (!list.length) return <p style={{ color: OV.soft }}>No {pick === "all" ? "" : STATUS[pick].label.toLowerCase() + " "}shows in this period.</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {list.map((s) => (
        <li key={s.key} className="min-w-0">
          <Link to={`/channel/${encodeURIComponent(s.key)}${q}`} className="group flex flex-col gap-2">
            <span className="relative">
              <Poster src={s.avatar_url} name={s.title} width="100%" className="transition-transform duration-150 group-hover:-translate-y-0.5" />
              <span className="absolute left-2 top-2"><StatusPill status={s.status} /></span>
            </span>
            <span className="truncate text-[15px] font-bold group-hover:underline">{s.title}</span>
            <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: OV.sand }}
                  role="img" aria-label={s.pct != null ? `${Math.round(s.pct * 100)}% watched` : "How much is unknown"}>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (s.pct ?? 0) * 100)}%`, background: STATUS[s.status].bar }} />
            </span>
            <span className="flex items-baseline justify-between gap-2 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
              <span className="truncate">{s.total != null ? `${num(s.watched)} of ${num(s.total)} eps` : `${num(s.watched)} eps`}</span>
              {s.pct != null && <span className="shrink-0 font-bold" style={{ color: OV.ink }}>{Math.round(s.pct * 100)}%</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
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

function BingeRow({ b, rank }: { b: Binge; rank: number }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/channel/${encodeURIComponent(b.key)}${q}`} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        <span className="w-5 shrink-0 text-right font-ov-display text-[15px] font-extrabold">{rank}</span>
        <Poster src={b.avatar_url} name={b.title} width="40px" className="!rounded-md !border-2" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold">{b.title} · Season {b.season}</span>
          <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
            {num(b.episodes)} episodes · {b.days === 1 ? date(b.start) : `${date(b.start)} – ${date(b.end)}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-ov-display text-[20px] font-extrabold leading-none">{b.days === 1 ? "1 day" : `${num(b.days)} days`}</span>
          <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{num(Math.round(b.per_day * 10) / 10)} a day</span>
        </span>
      </Link>
    </li>
  );
}

function RewatchRow({ t }: { t: TopResponse["items"][number] }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/video/${encodeURIComponent(t.key)}${q}`} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        {t.thumb ? <img src={t.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-[88px] shrink-0 rounded-md border-2 object-cover" style={{ borderColor: OV.ink }} />
                 : <span className="aspect-video w-[88px] shrink-0 rounded-md border-2" style={{ borderColor: OV.ink, background: OV.sand }} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold">{t.title}</span>
          <span className="truncate text-[12px]" style={{ color: OV.soft }}>{t.channel}</span>
        </span>
        <span className="font-ov-display text-[18px] font-extrabold">{t.count}×</span>
      </Link>
    </li>
  );
}
