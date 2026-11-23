/* Shows (Netflix): every show you watched in the period as a poster wall with how far you got,
   plus your fastest seasons and rewatches. */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { TopResponse } from "../../api";
import { Link, useCapability, useTheme } from "../../platform";
import { platformName } from "../../platform";
import { Meta, PosterCard } from "./animeUi";
import { QueryState, Section } from "../../components/ui";
import { Binge, ShowProgress, ShowStatus, useShows } from "./data";
import { FigureStrip, GREEN, PageHead, Poster, Progress, RED, STATUS, plural } from "./ui";
import { date, num } from "../../format";
import { rangeLabel, useFilters, useLinkQuery } from "../../filters";

type Progressed = { summary: Record<ShowStatus, number>; shows: ShowProgress[] };
type Rewatches = { detectable: boolean; items: TopResponse["items"] };
type Sort = "watched" | "recent" | "complete" | "az";
const SORTS: [Sort, string][] = [["watched", "Most watched"], ["recent", "Recently watched"], ["complete", "Most complete"], ["az", "A–Z"]];

export function Shows() {
  const { filters } = useFilters();
  const progress = useShows<Progressed>("progress", { limit: 500 });
  const binges = useShows<Binge[]>("binges", { limit: 10 });
  const rewatches = useShows<Rewatches>("rewatches");
  const [status, setStatus] = useState<ShowStatus | "all">("all");
  const [sort, setSort] = useState<Sort>("watched");
  const anime = useCapability("anime");

  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Shows" subtitle={`Every show you watched from ${rangeLabel(filters)}, and how far you got`} />

      <QueryState q={progress} minHeight={110}>
        {({ data: { summary, shows } }) => (
          <FigureStrip items={[
            { label: "Shows", value: num(shows.length) },
            { label: "Finished", value: num(summary.finished), color: GREEN, sub: "up to the latest episode" },
            { label: "Still watching", value: num(summary.watching), color: RED, sub: "watched in the last 30 days" },
            { label: "Dropped", value: num(summary.dropped), color: "#b3b3b3", sub: "unfinished, 30+ days ago" },
          ]} />
        )}
      </QueryState>

      <QueryState q={progress} minHeight={400} empty={(d) => !d.data.shows.length}>
        {({ data }) => (
          <section className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="no-scrollbar -mx-[4%] flex gap-2 overflow-x-auto px-[4%] sm:mx-0 sm:px-0" role="group" aria-label="Show status">
                {(["all", "finished", "watching", "dropped"] as const).map((s) => (
                  <button key={s} onClick={() => setStatus(s)} className={`nf-pill ${status === s ? "nf-pill-on" : ""}`}>
                    {s === "all" ? "All" : STATUS[s].label}
                    <span className={status === s ? "text-black/60" : "text-[#808080]"}>{num(s === "all" ? data.shows.length : data.summary[s])}</span>
                  </button>
                ))}
              </div>
              <SortMenu value={sort} onChange={setSort} />
            </div>
            <PosterWall shows={data.shows} status={status} sort={sort} />
          </section>
        )}
      </QueryState>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-12">
        <Section title="Fastest seasons" subtitle="Whole seasons, first episode to last">
          <QueryState q={binges} minHeight={200} empty={(d) => !d.data.length}>
            {(d) => <BingeList binges={d.data} />}
          </QueryState>
        </Section>
        <Section title="Rewatches" subtitle="Watched again at least a week later">
          <QueryState q={rewatches} minHeight={120}>
            {({ data }) => !data.detectable ? (
              <p className="text-[14px] text-[#b3b3b3]">
                {anime ? "Crunchyroll only keeps the latest play of each episode, so rewatches can't be seen."
                       : platformName() === "Netflix"
                         ? "Netflix's quick download lists each title once per account, so rewatches only show up across accounts or with the full data export (ViewingActivity.csv)."
                         : `Your ${platformName()} history lists each title once, so rewatches can't be seen.`}
              </p>
            ) : data.items.length ? <RewatchList items={data.items} /> : <p className="text-[14px] text-[#b3b3b3]">Nothing rewatched in this period.</p>}
          </QueryState>
        </Section>
      </div>
    </div>
  );
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="nf-select">
        {SORTS.find(([k]) => k === value)?.[1]} <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="nf-menu absolute right-0 top-full z-30 mt-1 w-48 py-1">
          {SORTS.map(([k, label]) => (
            <button key={k} onClick={() => { onChange(k); setOpen(false); }}
                    className={`block w-full px-4 py-2 text-left text-[14px] hover:bg-white/10 ${k === value ? "font-bold" : "text-[#e5e5e5]"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PosterWall({ shows, status, sort }: { shows: ShowProgress[]; status: ShowStatus | "all"; sort: Sort }) {
  const q = useLinkQuery();
  const cr = !!useTheme().anime;
  const list = useMemo(() => {
    const picked = shows.filter((s) => status === "all" || s.status === status);
    const by: Record<Sort, (a: ShowProgress, b: ShowProgress) => number> = {
      watched: () => 0,  // the API already ranks by episodes (or time)
      recent: (a, b) => b.last_watched.localeCompare(a.last_watched),
      complete: (a, b) => (b.pct ?? 0) - (a.pct ?? 0),
      az: (a, b) => a.title.localeCompare(b.title),
    };
    return [...picked].sort(by[sort]);
  }, [shows, status, sort]);
  if (!list.length) return <p className="text-[14px] text-[#b3b3b3]">No {status === "all" ? "" : STATUS[status as ShowStatus].label.toLowerCase()} shows in this period.</p>;
  return (
    <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 ${cr ? "gap-x-5 gap-y-8" : "gap-x-3 gap-y-7"}`}>
      {list.map((s) => (
        cr ? <PosterCard key={s.key} s={{ ...s, poster: s.avatar_url, genres: [] }} className="min-w-0"
                         line={<Meta items={[s.total != null ? `${num(s.watched)} of ${num(s.total)}` : `${num(s.watched)} eps`,
                                             s.pct != null ? `${Math.round(s.pct * 100)}%` : null]} />} /> :
        <Link key={s.key} to={`/channel/${s.key}${q}`} className="group min-w-0">
          <div className="transition-transform duration-200 group-hover:scale-[1.04]"><Poster src={s.avatar_url} /></div>
          <Progress pct={s.pct} status={s.status} className="mt-2" />
          <div className="mt-2 truncate text-[14px] font-bold">{s.title}</div>
          <div className="flex items-baseline justify-between gap-2 text-[12px] text-[#b3b3b3]">
            <span className="truncate">{s.total != null ? `${num(s.watched)} of ${num(s.total)}` : plural(s.watched, "ep")}</span>
            {s.pct != null && <span className="shrink-0 font-bold" style={{ color: STATUS[s.status].color }}>{Math.round(s.pct * 100)}%</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function BingeList({ binges }: { binges: Binge[] }) {
  const q = useLinkQuery();
  return (
    <ol className="flex flex-col">
      {binges.map((b, i) => (
        <li key={`${b.key}-${b.season}`}>
          <Link to={`/channel/${b.key}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
            <span className="w-7 shrink-0 text-right text-[22px] font-black tabular text-[#595959]">{i + 1}</span>
            <div className="w-10 shrink-0"><Poster src={b.avatar_url} size="w185" className="rounded-[3px]" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">{b.title} · Season {b.season}</div>
              <div className="truncate text-[13px] text-[#b3b3b3]">
                {plural(b.episodes, "episode")} · {b.days === 1 ? date(b.start) : `${date(b.start)} – ${date(b.end)}`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[20px] font-black leading-none" style={{ color: RED }}>{plural(b.days, "day")}</div>
              <div className="mt-1 text-[12px] text-[#808080]">{num(Math.round(b.per_day * 10) / 10)} a day</div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function RewatchList({ items }: { items: TopResponse["items"] }) {
  const q = useLinkQuery();
  return (
    <ol className="flex flex-col">
      {items.slice(0, 10).map((t) => (
        <li key={t.key}>
          <Link to={`/video/${t.key}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
            <div className="aspect-video w-[96px] shrink-0 overflow-hidden rounded-[4px] bg-[#2f2f2f]">
              {t.thumb && <img src={t.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">{t.title}</div>
              <div className="truncate text-[13px] text-[#b3b3b3]">{t.channel}</div>
            </div>
            <span className="shrink-0 text-[15px] font-bold tabular">{t.count}×</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
