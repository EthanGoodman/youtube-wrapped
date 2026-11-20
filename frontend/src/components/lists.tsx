import { Link } from "../platform";
import { RankedItem, WatchInfo } from "../api";
import { clockTime, compact, date, duration, num, pct } from "../format";
import { useFilters, useLinkQuery } from "../filters";
import { Avatar, Carousel, RankChange, Thumb } from "./ui";

/** The measure shown for an item, following the ranking metric. */
function measure(item: RankedItem, metric: "count" | "time", unit = "videos") {
  return metric === "time" ? duration(item.time_s) : `${num(item.count)} ${item.count === 1 ? unit.replace(/s$/, "") : unit}`;
}

/** "99 Shorts" / "all Shorts" note, so it's clear when a rank comes from Shorts. */
export function shortsNote(item: RankedItem): string | null {
  if (!item.shorts) return null;
  return item.shorts >= item.count ? "all Shorts" : `${num(item.shorts)} Shorts`;
}

/** Horizontal carousel of round channel avatars with rank numbers (stats.fm "top artists"). */
export function ChannelCarousel({ items }: { items: RankedItem[] }) {
  const q = useLinkQuery();
  const { filters } = useFilters();
  return (
    <Carousel>
      {items.map((c) => (
        <Link key={c.key} to={`/channel/${c.key}${q}`}
              className="group flex w-[104px] shrink-0 flex-col items-center text-center sm:w-[124px]">
          <div className="relative">
            <Avatar src={c.avatar_url} name={c.title} size={96}
                    className="transition-transform group-hover:scale-[1.03] sm:!h-[116px] sm:!w-[116px]" />
            <span className="absolute -left-1 -top-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-bg px-1.5 text-sm font-black ring-2 ring-card">
              {c.rank}
            </span>
          </div>
          <div className="mt-2 line-clamp-1 w-full text-sm font-medium">{c.title ?? "Unknown channel"}</div>
          <div className="flex items-center gap-1.5 text-xs text-sub">
            {measure(c, filters.metric)} <RankChange item={c} />
          </div>
          {shortsNote(c) && <div className="text-[11px] text-muted">{shortsNote(c)}</div>}
        </Link>
      ))}
    </Carousel>
  );
}

/** Ranked rows for channels (avatar) or videos (thumbnail). */
export function RankedRows({ items, kind, showShare = false, compactRows = false }: {
  items: RankedItem[];
  kind: "channel" | "video";
  showShare?: boolean;
  compactRows?: boolean;
}) {
  const q = useLinkQuery();
  const { filters } = useFilters();
  return (
    <ol className="flex flex-col">
      {items.map((it) => {
        const to = kind === "channel" ? `/channel/${it.key}${q}` : `/video/${it.key}${q}`;
        const unavailable = kind === "video" && !it.title;
        return (
          <li key={it.key}>
            <Link to={to} className="link-row -mx-2">
              <span className="w-7 shrink-0 text-center text-base font-black text-sub tabular">{it.rank}</span>
              {kind === "channel" ? (
                <Avatar src={it.avatar_url} name={it.title} size={compactRows ? 40 : 48} />
              ) : (
                <Thumb src={it.thumb} videoId={it.key} short={it.bucket === "short"} width={compactRows ? 96 : 120} />
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium leading-snug">
                  {unavailable ? <span className="text-sub">Unavailable video</span> : it.title ?? "Unknown"}
                </div>
                <div className="mt-0.5 truncate text-xs text-sub">
                  {kind === "video"
                    ? [it.channel, it.duration_s ? duration(it.duration_s) : null].filter(Boolean).join(" · ")
                    : [it.subscriber_count != null ? `${compact(it.subscriber_count)} subscribers`
                        : it.first_watched && `since ${date(it.first_watched)}`, shortsNote(it)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                <span className="text-sm font-medium tabular">
                  {kind === "video" && filters.metric === "count" ? `${it.count}×` : measure(it, filters.metric)}
                </span>
                <span className="flex items-center gap-2 text-xs text-sub">
                  {showShare && <span className="tabular">{pct(it.share, 1)}</span>}
                  <RankChange item={it} />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** stats.fm-style genre list: rank, name, proportional bar. Single measure -> one hue. */
export function BarList({ items, linkTo, metric }: {
  items: RankedItem[];
  linkTo?: (item: RankedItem) => string;
  metric: "count" | "time";
}) {
  const q = useLinkQuery();
  const val = (i: RankedItem) => (metric === "time" ? i.time_s : i.count);
  const max = Math.max(1, ...items.map(val));
  return (
    <ol className="flex flex-col gap-1.5">
      {items.map((it) => {
        const body = (
          <div className="group relative flex h-9 items-center overflow-hidden rounded-lg">
            <div className="absolute inset-y-0 left-0 rounded-lg bg-yt-soft/25 transition-colors group-hover:bg-yt-soft/35"
                 style={{ width: `${Math.max(3, (val(it) / max) * 100)}%` }} />
            <span className="relative w-8 shrink-0 text-center text-sm font-black text-sub tabular">{it.rank}</span>
            <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{it.title ?? it.key}</span>
            <span className="relative flex shrink-0 items-center gap-2 px-3 text-xs text-sub tabular">
              {metric === "time" ? duration(it.time_s) : num(it.count)}
              <RankChange item={it} />
            </span>
          </div>
        );
        return <li key={it.key}>{linkTo ? <Link to={linkTo(it) + q}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}

export function WatchRows({ items }: { items: WatchInfo[] }) {
  const q = useLinkQuery();
  return (
    <ul className="flex flex-col">
      {items.map((w) => (
        <li key={w.entry_id}>
          <Link to={w.video_id ? `/video/${w.video_id}${q}` : "#"} className="link-row -mx-2">
            <Thumb src={w.thumb} videoId={w.video_id} short={w.bucket === "short"} width={96} />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-medium leading-snug">
                {w.title && !w.title.startsWith("http") ? w.title : <span className="text-sub">Unavailable video</span>}
              </div>
              <div className="mt-0.5 truncate text-xs text-sub">{w.channel ?? "Unknown channel"}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-sub">
              <div>{date(w.local_iso)}</div>
              <div>{clockTime(w.local_iso)}</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
