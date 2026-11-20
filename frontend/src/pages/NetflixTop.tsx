/* Top lists on Netflix: shows, titles (episodes), movies and genres, as Netflix-flavored rankings. */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { RankedItem, TopResponse, useStats } from "../api";
import { Link, NavLink, usePlatform } from "../platform";
import { PosterCard } from "../components/cr";
import { QueryState, RankChange } from "../components/ui";
import { BarList } from "../components/lists";
import { ShowProgress, useShows } from "../components/shows";
import { OutlinedRank, PageHead, Poster, Progress, StatusLabel, Toggle, hours, plural } from "../components/nf";
import { duration, num, pct } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

const TABS: [string, string][] = [["channels", "Shows"], ["videos", "Titles"], ["movies", "Movies"], ["genres", "Genres"]];

interface MovieItem extends RankedItem { poster?: string | null; year?: string | null; runtime_s?: number | null; genres?: string[] }

export function NetflixTop() {
  const { kind = "channels" } = useParams();
  const { filters, update } = useFilters();
  const q = useLinkQuery();
  const [limit, setLimit] = useState(50);
  const unit = kind === "channels" ? "Episodes" : "Times";
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Top lists" subtitle={`Your most watched, from ${rangeLabel(filters)}`}>
        <Toggle label="Rank by" value={filters.metric} onChange={(m) => update({ metric: m })}
                options={[["count", kind === "genres" ? "Titles" : unit], ["time", "Time"]]} />
      </PageHead>
      <div className="no-scrollbar -mx-[4%] flex gap-2 overflow-x-auto px-[4%]" role="tablist">
        {TABS.map(([k, label]) => (
          <NavLink key={k} to={`/top/${k}${q}`} role="tab" className={`nf-pill ${kind === k ? "nf-pill-on" : ""}`}>{label}</NavLink>
        ))}
      </div>
      {kind === "channels" ? <TopShows limit={limit} />
        : kind === "videos" ? <TopTitles limit={limit} />
        : kind === "movies" ? <TopMovies limit={limit} />
        : <TopGenres />}
      {kind !== "genres" && (
        <button onClick={() => setLimit(limit === 50 ? 250 : 50)} className="btn-secondary self-center">
          {limit === 50 ? "Show more" : "Show fewer"}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shows

function TopShows({ limit }: { limit: number }) {
  const { filters } = useFilters();
  const top = useStats<TopResponse>("top/channels", { limit });
  const prog = useShows<{ shows: ShowProgress[] }>("progress", { limit: 500 });
  const byKey = new Map((prog.data?.data.shows ?? []).map((s) => [s.key, s]));
  const cr = usePlatform()?.theme === "crunchyroll";
  return (
    <QueryState q={top} minHeight={500} empty={(d) => !d.items.length}>
      {(d) => (
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {d.items.slice(0, 10).map((s) => cr
              ? <PosterCard key={s.key} s={{ key: s.key, title: s.title ?? "", poster: s.avatar_url ?? null, count: s.count, time_s: s.time_s,
                                             rank: s.rank, genres: [], ...(byKey.get(s.key) ?? {}) }} />
              : <TopTile key={s.key} s={s} p={byKey.get(s.key)} metric={filters.metric} />)}
          </div>
          {d.items.length > 10 && (
            <ol className="flex flex-col">
              {d.items.slice(10).map((s) => <ShowRow key={s.key} s={s} p={byKey.get(s.key)} metric={filters.metric} />)}
            </ol>
          )}
        </div>
      )}
    </QueryState>
  );
}

function TopTile({ s, p, metric }: { s: RankedItem; p?: ShowProgress; metric: "count" | "time" }) {
  const q = useLinkQuery();
  return (
    <Link to={`/channel/${s.key}${q}`} className="group flex min-w-0 flex-col">
      <div className="flex items-end">
        <OutlinedRank n={s.rank} className="w-[48%] shrink-0" />
        <div className="-ml-[4%] w-[56%] shrink-0 transition-transform duration-200 group-hover:scale-[1.04]">
          <Poster src={s.avatar_url} />
        </div>
      </div>
      <div className="ml-[44%] mt-2.5 min-w-0">
        <div className="truncate text-[15px] font-bold">{s.title}</div>
        <div className="flex items-center gap-1.5 text-[13px] text-[#b3b3b3]">
          {metric === "time" ? hours(s.time_s) : plural(s.count, "ep")} <RankChange item={s} />
        </div>
        {p && <Progress pct={p.pct} status={p.status} className="mt-2" />}
      </div>
    </Link>
  );
}

function ShowRow({ s, p, metric }: { s: RankedItem; p?: ShowProgress; metric: "count" | "time" }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={`/channel/${s.key}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
        <span className="w-9 shrink-0 text-right text-[22px] font-black tabular text-[#595959]">{s.rank}</span>
        <div className="w-10 shrink-0"><Poster src={s.avatar_url} size="w185" className="rounded-[3px]" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[15px] font-bold">{s.title}</span>
            {p && <StatusLabel status={p.status} />}
          </div>
          {p && <Progress pct={p.pct} status={p.status} className="mt-2" />}
          <div className="mt-1.5 text-[12px] text-[#b3b3b3]">
            {p?.total ? `${num(p.watched)} of ${num(p.total)} episodes` : plural(s.count, "episode")}
          </div>
        </div>
        <div className="w-24 shrink-0 text-right">
          <div className="text-[15px] font-bold tabular">{metric === "time" ? hours(s.time_s) : plural(s.count, "ep")}</div>
          <div className="flex items-center justify-end gap-1.5 text-[12px] text-[#808080]">{pct(s.share, 1)} <RankChange item={s} /></div>
        </div>
      </Link>
    </li>
  );
}

// ------------------------------------------------------------------ titles (episodes)

function TopTitles({ limit }: { limit: number }) {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const top = useStats<TopResponse>("top/videos", { limit });
  return (
    <QueryState q={top} minHeight={500} empty={(d) => !d.items.length}>
      {(d) => (
        <>
          {filters.metric === "count" && <p className="-mt-4 text-[13px] text-[#808080]">Ranked by how many times you watched each one.</p>}
          <ol className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            {d.items.map((t) => (
              <li key={t.key}>
                <Link to={`/video/${t.key}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                  <span className="w-8 shrink-0 text-right text-[22px] font-black tabular text-[#595959]">{t.rank}</span>
                  <div className="aspect-video w-[120px] shrink-0 overflow-hidden rounded-[4px] bg-[#2f2f2f]">
                    {t.thumb && <img src={t.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{t.title}</div>
                    <div className="truncate text-[13px] text-[#b3b3b3]">{[t.channel, t.duration_s ? duration(t.duration_s) : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="shrink-0 text-right text-[15px] font-bold tabular">{filters.metric === "time" ? hours(t.time_s) : `${t.count}×`}</div>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </QueryState>
  );
}

// ------------------------------------------------------------------ movies

function TopMovies({ limit }: { limit: number }) {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const top = useStats<{ items: MovieItem[] }>("top/movies", { limit });
  return (
    <QueryState q={top} minHeight={500} empty={(d) => !d.items.length}>
      {(d) => (
        <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {d.items.map((m) => (
            <Link key={m.key} to={`/video/${m.key}${q}`} className="group min-w-0">
              <div className="relative transition-transform duration-200 group-hover:scale-[1.04]">
                <Poster src={m.poster ?? m.thumb} />
                <span className="absolute left-1.5 top-1.5 rounded-[2px] bg-black/75 px-1.5 py-0.5 text-[12px] font-black">#{m.rank}</span>
              </div>
              <div className="mt-2.5 truncate text-[14px] font-bold">{m.title}</div>
              <div className="truncate text-[12px] text-[#b3b3b3]">{[m.year, m.runtime_s ? duration(m.runtime_s) : null].filter(Boolean).join(" · ")}</div>
              <div className="truncate text-[12px] text-[#808080]">
                {filters.metric === "time" ? hours(m.time_s) : m.count > 1 ? `watched ${m.count}×` : m.genres?.[0] ?? ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </QueryState>
  );
}

// ------------------------------------------------------------------ genres

function TopGenres() {
  const { filters } = useFilters();
  const top = useStats<TopResponse>("top/genres", { limit: 30 });
  return (
    <QueryState q={top} minHeight={400} empty={(d) => !d.items.length}>
      {(d) => (
        <div className="max-w-[900px]">
          <BarList items={d.items} metric={filters.metric} linkTo={(g) => `/genre/${encodeURIComponent(g.key)}`} />
        </div>
      )}
    </QueryState>
  );
}
