/* Top lists in the new look: one page for channels, videos, genres (and the rest), so every family can reuse it.
   The big three first, then the ranked list; ranked like the home page (by hours, long videos unless you picked Shorts). */
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Link, useCapability } from "../platform";
import { Metric, useFilters, useLinkQuery } from "../filters";
import { RankedItem, TopResponse, useMeta, useStats } from "../api";
import { num, pct } from "../format";
import { Cover, MoveBadge, OV, PageBody, PageHeader, Pic, Poster, Seg, Skeleton, StatsFrame, kicker, useCreator, useFamily, useNoun, usePrevRanks, useTime, useVerb } from "./kit";
import { periodTitle, rankMove, rankingFilters } from "./takeaways";

type Shape = "face" | "poster" | "cover" | "thumb" | "none";
/* `unit` is what the count counts; `once` lists are things you rarely repeat (their arrows would all say "new",
   and they rank by rewatches unless you ask for hours) */
interface Kind { kind: string; label: string; noun: string; shape: Shape; unit: [string, string]; once?: boolean; byCount?: boolean; link?: (k: string) => string; cap?: string; music?: boolean }
const VIDEO_KINDS: Kind[] = [
  { kind: "channels", label: "Channels", noun: "channels", shape: "face", unit: ["video", "videos"], link: (k) => `/channel/${encodeURIComponent(k)}` },
  { kind: "videos", label: "Videos", noun: "videos", shape: "thumb", unit: ["time", "times"], once: true, link: (k) => `/video/${encodeURIComponent(k)}` },
  { kind: "genres", label: "Genres", noun: "genres", shape: "none", unit: ["video", "videos"], link: (k) => `/genre/${encodeURIComponent(k)}` },
  { kind: "categories", label: "Categories", noun: "categories", shape: "none", unit: ["video", "videos"], link: (k) => `/category/${k}`, cap: "categories" },
  { kind: "tags", label: "Tags", noun: "tags", shape: "none", unit: ["video", "videos"], cap: "tags" },
  { kind: "artists", label: "Artists", noun: "artists", shape: "face", unit: ["song", "songs"], music: true },
  { kind: "songs", label: "Songs", noun: "songs", shape: "thumb", unit: ["time", "times"], once: true, music: true },
];
const SHOW_KINDS: Kind[] = [
  { kind: "channels", label: "Shows", noun: "shows", shape: "poster", unit: ["episode", "episodes"], link: (k) => `/channel/${encodeURIComponent(k)}` },
  { kind: "movies", label: "Movies", noun: "movies", shape: "poster", unit: ["time", "times"], once: true, link: (k) => `/video/${encodeURIComponent(k)}` },
  { kind: "videos", label: "Titles", noun: "titles", shape: "thumb", unit: ["time", "times"], once: true, link: (k) => `/video/${encodeURIComponent(k)}` },
  { kind: "genres", label: "Genres", noun: "genres", shape: "none", unit: ["title", "titles"], link: (k) => `/genre/${encodeURIComponent(k)}` },
];
/* games: one row per game per day played, so the count is days played */
const GAME_KINDS: Kind[] = [
  { kind: "channels", label: "Games", noun: "games", shape: "poster", unit: ["day played", "days played"], link: (k) => `/channel/${encodeURIComponent(k)}` },
  { kind: "genres", label: "Genres", noun: "genres", shape: "none", unit: ["day played", "days played"], cap: "genres", link: (k) => `/genre/${encodeURIComponent(k)}` },
];
/* music ranks tracks by streams by default (as stats.fm does); artists and albums by hours */
const MUSIC_KINDS: Kind[] = [
  { kind: "videos", label: "Tracks", noun: "tracks", shape: "cover", unit: ["stream", "streams"], byCount: true, link: (k) => `/video/${encodeURIComponent(k)}` },
  { kind: "channels", label: "Artists", noun: "artists", shape: "face", unit: ["stream", "streams"], link: (k) => `/channel/${encodeURIComponent(k)}` },
  { kind: "albums", label: "Albums", noun: "albums", shape: "cover", unit: ["stream", "streams"], link: (k) => `/album/${encodeURIComponent(k)}` },
  { kind: "genres", label: "Genres", noun: "genres", shape: "none", unit: ["stream", "streams"], cap: "genres", link: (k) => `/genre/${encodeURIComponent(k)}` },
];

export function TopPage() {
  const tm = useTime();
  const { kind = "channels" } = useParams();
  const { filters } = useFilters();
  const [params, setParams] = useSearchParams();
  const meta = useMeta().data;
  const navigate = useNavigate();
  const q = useLinkQuery();
  const caps = meta?.platform.capabilities;
  const shorts = useCapability("shorts");
  const estimated = useCapability("estimated_time") && !shorts;   // Netflix's quick download: times are estimates
  const { verbed } = useVerb();
  const cr = useCreator();
  const n = useNoun();
  const anime = useCapability("anime");
  // shows family: the platform's own words (shows / series, titles / episodes); no movie list without movies
  const family = useFamily();
  const KINDS = family === "games" ? GAME_KINDS : family === "music" ? MUSIC_KINDS : family === "shows"
    ? SHOW_KINDS.filter((x) => !(anime && x.kind === "movies")).map((x) =>
        x.kind === "channels" ? { ...x, label: cr.Many, noun: cr.many }
        : x.kind === "videos" ? { ...x, label: n.Many, noun: n.many }
        : x.kind === "genres" ? { ...x, unit: [n.one, n.many] as [string, string] } : x)
    : VIDEO_KINDS;
  const kinds = KINDS.filter((k) => (!k.music || meta?.has_music) && (!k.cap || !caps || caps.includes(k.cap)));
  const k = kinds.find((x) => x.kind === kind) ?? KINDS[0];
  // hours by default (like the home page); videos rank by rewatches unless you ask for hours
  const metric: Metric = (params.get("metric") as Metric | null) ?? (KINDS.find((x) => x.kind === kind)?.once || KINDS.find((x) => x.kind === kind)?.byCount ? "count" : "time");
  const ranked = { ...(k.shape === "none" ? filters : rankingFilters(filters)), metric };
  const [limit, setLimit] = useState(50);
  const top = useStats<TopResponse>(`top/${k.kind}`, { limit }, { filters: ranked });
  const prev = usePrevRanks(k.kind, ranked);
  // single videos rarely repeat year to year, so their arrows would all say "new": only lists of things you return to get them
  const moves = !k.once;
  const cmp = moves ? prev.cmp : null;
  const prevRank = (c: RankedItem) => (moves ? prev.prevRank(c) : undefined);
  const items = top.data?.items;
  const setMetric = (m: Metric) => setParams((p) => { const n = new URLSearchParams(p); n.set("metric", m); return n; }, { replace: true });
  const value = (c: RankedItem) => (metric === "time" ? tm.fmt(c.time_s) : `${num(c.count)} ${k.unit[c.count === 1 ? 0 : 1]}`);
  const max = items?.length ? Math.max(1, metric === "time" ? items[0].time_s : items[0].count) : 1;
  const share = (c: RankedItem) => (metric === "time" ? c.time_s : c.count) / max;

  return (
    <StatsFrame>
      <PageHeader label={`Top lists · ${periodTitle(filters, meta?.today)}`} title={`Your top ${k.noun}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="List" dark value={k.kind} options={kinds.map((x) => [x.kind, x.label])}
               onChange={(v) => { setLimit(50); navigate(`/${meta?.platform.id ?? "youtube"}/top/${v}${q}`); }} />
          <span className="ml-2 font-shelf-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: OV.mute }} aria-hidden>Rank by</span>
          <Seg label="Rank by" dark value={metric} options={[["time", tm.Unit], ["count", k.once ? "Rewatches" : k.unit[1].charAt(0).toUpperCase() + k.unit[1].slice(1)]]} onChange={setMetric} />
        </div>
        <p className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>
          Ranked by {metric === "time" ? `${tm.unit} ${verbed}${estimated ? " (estimated)" : ""}` : k.once ? `how often you ${verbed} it` : `${k.unit[1]} ${verbed}`}
          {shorts && k.shape !== "none" && filters.buckets.includes("long") ? " · long videos only (pick Shorts in the top bar to rank those)" : ""}
          {cmp ? ` · arrows since ${cmp.label}` : ""}
        </p>
      </PageHeader>
      <PageBody>
        {!items ? <Skeleton h={420} /> : !items.length ? <p style={{ color: OV.soft }}>Nothing in this period.</p> : (
          <>
            <Podium items={items.slice(0, 3)} k={k} value={value} move={(c) => rankMove(c.rank, prevRank(c))} />
            {items.length > 3 && (
              <section aria-label={`More ${k.noun}`} className="flex flex-col gap-2">
                <span className={kicker} style={{ color: OV.soft }}>The rest of your top {items.length}</span>
                <ol start={4} className="flex flex-col">
                  {items.slice(3).map((c) => (
                    <Row key={c.key} c={c} k={k} value={value(c)} share={share(c)} move={rankMove(c.rank, prevRank(c))} />
                  ))}
                </ol>
                {items.length >= limit && limit < 250 && (
                  <button type="button" onClick={() => setLimit(limit === 50 ? 100 : 250)}
                          className="mt-3 min-h-11 self-center rounded-full border-2 px-6 text-[15px] font-medium hover:bg-black/[0.04]"
                          style={{ borderColor: OV.ink }}>
                    Show {limit === 50 ? 100 : 250}
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}

/** The line under a track or album: its channel or artist. */
const byLine = (c: RankedItem) => c.channel ?? (c as RankedItem & { artist?: string | null }).artist ?? null;

function href(k: Kind, c: RankedItem, q: string): string | null {
  return k.link ? k.link(c.key) + q : null;
}

function Picture({ c, k, size }: { c: RankedItem & { poster?: string | null; cover?: string | null }; k: Kind; size: number }) {
  if (k.shape === "face") return <Pic src={c.avatar_url} name={c.title} size={`${size}px`} />;
  if (k.shape === "cover") return <Cover src={c.thumb ?? c.cover ?? c.avatar_url} name={c.title} size={`${size}px`} className={size < 60 ? "!border-2" : ""} />;
  if (k.shape === "poster") return <Poster src={c.avatar_url ?? c.poster ?? c.thumb} name={c.title} width={`${Math.round(size * 0.78)}px`} className={size < 60 ? "!rounded-md !border-2" : ""} />;
  if (k.shape === "thumb") {
    const src = c.thumb ?? (c.key && !c.key.includes(":") ? `https://i.ytimg.com/vi/${c.key}/mqdefault.jpg` : null);
    return src
      ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="shrink-0 rounded-lg border-2 object-cover"
             style={{ width: Math.round(size * 1.6), aspectRatio: "16 / 9", borderColor: OV.ink }} />
      : <span className="shrink-0 rounded-lg border-2" style={{ width: Math.round(size * 1.6), aspectRatio: "16 / 9", borderColor: OV.ink, background: OV.sand }} />;
  }
  return null;
}

/* The top 3 in podium order (2 · 1 · 3). #1 is a bit bigger and filled; medal colors live only in the small
   medal sticker at the top of each card (gold, silver, bronze), so the section stays calm. */
const PODIUM = [
  { medal: "#E2A93B", ring: "#B98320", pic: 136, thumb: 132, name: 19, value: 38, pad: "px-6 pb-7 pt-10", order: "md:order-2", fill: "#E2A93B" },
  { medal: "#D3D6D9", ring: "#9EA3A8", pic: 112, thumb: 116, name: 17, value: 32, pad: "px-5 pb-6 pt-9", order: "md:order-1", fill: "#FBF6EC" },
  { medal: "#CD8F5E", ring: "#9C6437", pic: 104, thumb: 108, name: 16, value: 30, pad: "px-5 pb-6 pt-9", order: "md:order-3", fill: "#FBF6EC" },
];

function Podium({ items, k, value, move }: {
  items: RankedItem[]; k: Kind; value: (c: RankedItem) => string; move: (c: RankedItem) => ReturnType<typeof rankMove>;
}) {
  const { verbed } = useVerb();
  const q = useLinkQuery();
  return (
    // #1 in the middle and biggest, #2 left, #3 right (phones: 1, 2, 3 stacked)
    <section aria-label={`Your top 3 ${k.noun}`} className="mx-auto grid w-full max-w-[1040px] items-end gap-x-4 gap-y-8 pt-4 md:grid-cols-[1fr_1.18fr_1fr]">
      {items.map((c) => {
        const to = href(k, c, q);
        const p = PODIUM[c.rank - 1] ?? PODIUM[2];
        const body = (
          <>
            <span aria-label={`Number ${c.rank}`} className="absolute -top-6 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                  style={{ background: p.medal, borderColor: OV.ink, boxShadow: `inset 0 0 0 3px ${p.ring}`, color: OV.ink }}>
              {c.rank}
            </span>
            <Picture c={c} k={k} size={k.shape === "thumb" ? p.thumb : p.pic} />
            <span className="line-clamp-2 font-bold leading-snug" style={{ fontSize: p.name }}>{c.title ?? "Unknown"}</span>
            {(k.shape === "thumb" || k.kind === "videos" || k.kind === "albums") && byLine(c) && <span className="text-[13px]" style={{ color: c.rank === 1 ? OV.ink : OV.soft }}>{byLine(c)}</span>}
            <span className="font-ov-display font-extrabold leading-none" style={{ fontSize: p.value }}>{value(c)}</span>
            {k.shape === "none" && <span className="font-shelf-mono text-[12px]">in {pct(c.share)} of what you {verbed}</span>}
            <MoveBadge m={move(c)} />
          </>
        );
        const cls = `relative flex flex-col items-center gap-2 rounded-2xl border-2 text-center ${p.order} ${p.pad}`;
        const style = { background: p.fill, borderColor: OV.ink };
        return to
          ? <Link key={c.key} to={to} className={`${cls} transition-transform hover:-translate-y-0.5`} style={style}>{body}</Link>
          : <div key={c.key} className={cls} style={style}>{body}</div>;
      })}
    </section>
  );
}

function Row({ c, k, value, share, move }: { c: RankedItem; k: Kind; value: string; share: number; move: ReturnType<typeof rankMove> }) {
  const q = useLinkQuery();
  const to = href(k, c, q);
  const inner = (
    <>
      <span className="w-8 shrink-0 text-right font-ov-display text-[17px] font-extrabold">{c.rank}</span>
      <Picture c={c} k={k} size={44} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{c.title ?? "Unknown"}</span>
        {(k.shape === "thumb" || k.kind === "videos" || k.kind === "albums") && byLine(c) && <span className="truncate text-[12px]" style={{ color: OV.soft }}>{byLine(c)}</span>}
      </span>
      <span aria-hidden className="hidden h-2.5 w-[28%] overflow-hidden rounded-full sm:block" style={{ background: OV.sand }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: OV.ink }} />
      </span>
      <span className="w-[92px] shrink-0 text-right font-ov-display text-[16px] font-extrabold">{value}</span>
      <span className="hidden w-[84px] shrink-0 sm:flex sm:justify-end"><MoveBadge m={move} /></span>
    </>
  );
  const cls = "flex items-center gap-3 border-b py-2.5";
  return (
    <li>
      {to ? <Link to={to} className={`${cls} hover:bg-black/[0.03]`} style={{ borderColor: "#E0D5C1" }}>{inner}</Link>
          : <div className={cls} style={{ borderColor: "#E0D5C1" }}>{inner}</div>}
    </li>
  );
}
