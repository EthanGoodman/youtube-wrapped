import { useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { LayoutGrid, List } from "lucide-react";
import { RankedItem, TopResponse, useMeta, useStats } from "../api";
import { BarList, RankedRows, shortsNote } from "../components/lists";
import { Avatar, MetricToggle, PageTitle, QueryState, RankChange, Section } from "../components/ui";
import { duration, num } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

const TABS: { kind: string; label: string; music?: boolean }[] = [
  { kind: "channels", label: "Channels" },
  { kind: "videos", label: "Videos" },
  { kind: "categories", label: "Categories" },
  { kind: "genres", label: "Genres" },
  { kind: "tags", label: "Tags" },
  { kind: "artists", label: "Artists", music: true },
  { kind: "songs", label: "Songs", music: true },
];

const SUBTITLE: Record<string, string> = {
  channels: "channels",
  videos: "most rewatched videos",
  categories: "YouTube categories",
  genres: "genres (YouTube topic tags)",
  tags: "video tags",
  artists: "YouTube Music artists",
  songs: "YouTube Music songs",
};

export function Top() {
  const { kind = "channels" } = useParams();
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const q = useLinkQuery();
  const [limit, setLimit] = useState(50);
  const [grid, setGrid] = useState(false);
  const top = useStats<TopResponse>(`top/${kind}`, { limit });
  const tabs = TABS.filter((t) => !t.music || meta?.has_music);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Top lists" />
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
        {tabs.map((t) => (
          <NavLink key={t.kind} to={`/top/${t.kind}${q}`} role="tab"
                   className={({ isActive }) => `chip ${isActive ? "chip-active" : ""}`}>
            {t.label}
          </NavLink>
        ))}
      </div>

      <Section
        title={`Top ${TABS.find((t) => t.kind === kind)?.label.toLowerCase() ?? kind}`}
        subtitle={<>Your top {SUBTITLE[kind] ?? kind} from {rangeLabel(filters)}{kind === "videos" && filters.metric === "count" && " · ranked by rewatches"}</>}
        action={
          <>
            {kind === "channels" && (
              <div className="seg" role="group" aria-label="View">
                <button aria-pressed={!grid} onClick={() => setGrid(false)} aria-label="List"><List size={14} /></button>
                <button aria-pressed={grid} onClick={() => setGrid(true)} aria-label="Grid"><LayoutGrid size={14} /></button>
              </div>
            )}
            <MetricToggle value={filters.metric} onChange={(m) => update({ metric: m })} />
          </>
        }
      >
        <QueryState q={top} minHeight={400} empty={(d) => !d.items.length}>
          {(d) => (
            <>
              {kind === "channels" && grid ? <ChannelGrid items={d.items} /> :
               kind === "channels" || kind === "artists" ? <RankedRows items={d.items} kind="channel" showShare /> :
               kind === "videos" || kind === "songs" ? <RankedRows items={d.items} kind="video" showShare /> :
               <BarList items={d.items} metric={filters.metric}
                        linkTo={kind === "categories" ? (c) => `/category/${c.key}` :
                                kind === "genres" ? (g) => `/genre/${encodeURIComponent(g.key)}` : undefined} />}
              {d.items.length >= limit && limit < 250 && (
                <button onClick={() => setLimit(limit === 50 ? 100 : 250)}
                        className="mt-3 w-full rounded-full bg-raised py-2 text-sm font-medium hover:bg-[#3f3f3f]">
                  Show {limit === 50 ? 100 : 250}
                </button>
              )}
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function ChannelGrid({ items }: { items: RankedItem[] }) {
  const q = useLinkQuery();
  const { filters } = useFilters();
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {items.map((c) => (
        <Link key={c.key} to={`/channel/${c.key}${q}`} className="group flex min-w-0 flex-col items-center text-center">
          <div className="relative w-full max-w-[128px]">
            <Avatar src={c.avatar_url} name={c.title} size={128} className="!h-auto !w-full aspect-square transition-transform group-hover:scale-[1.03]" />
            <span className="absolute -left-1 -top-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-bg px-1.5 text-sm font-black ring-2 ring-card">
              {c.rank}
            </span>
          </div>
          <div className="mt-2 line-clamp-1 w-full text-sm font-medium">{c.title ?? "Unknown"}</div>
          <div className="flex items-center gap-1.5 text-xs text-sub">
            {filters.metric === "time" ? duration(c.time_s) : `${num(c.count)} videos`} <RankChange item={c} />
          </div>
          {shortsNote(c) && <div className="text-[11px] text-muted">{shortsNote(c)}</div>}
        </Link>
      ))}
    </div>
  );
}
