/* The home page for music platforms (Spotify first), in the shared look. From the priority table: hours listened and
   your top songs up top; then the must-haves (top artists, top albums, evolution, records); patterns as a link.
   Ranked like stats.fm: songs by streams (plays of 30 s or more), artists and albums by hours. */
import { ReactNode } from "react";
import { Link, useCapability } from "../platform";
import { HourPoint, Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { compact, date, num } from "../format";
import { Band, Cover, MoveBadge, OV, Pic, ScrollRow, Skeleton, StatsFrame, kicker, useAccent, usePrevRanks } from "./kit";
import { ReignTimeline, YearTop, reignTitle } from "./ReignTimeline";
import {
  Comparison, Move, changeLine, clockFacts, hourLabel, hoursShort, periodTitle, rankMove, spanLabel, topHeadline,
  yearsToShow,
} from "./takeaways";

type Music = RankedItem & { artist?: string | null; cover?: string | null };
interface Streak { days: number; start: string; end: string }
interface RecordsResponse { streaks: { longest: Streak | null }; biggest_day: { by_count: { date: string; count: number } | null } }
interface MusicRecords { on_repeat: { key: string; title: string; artist: string; cover: string | null; date: string; count: number } | null }

const streams = (n: number) => `${num(n)} stream${n === 1 ? "" : "s"}`;
const songLink = (k: string) => `/video/${encodeURIComponent(k)}`;

export function MusicOverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const byTime = { ...filters, metric: "time" as const };
  const byCount = { ...filters, metric: "count" as const };
  const ov = useStats<Overview>("overview");
  const artists = useStats<TopResponse>("top/channels", { limit: 6 }, { filters: byTime });
  const songs = useStats<TopResponse>("top/videos", { limit: 10 }, { filters: byCount });
  const { cmp, prevRank } = usePrevRanks("channels", byTime);
  const songsPrev = usePrevRanks("videos", byCount);
  const sameSpan = cmp?.start ? { ...filters, range: "custom", start: cmp.start, end: cmp.end } : null;
  const lastOv = useStats<Overview>("overview", {}, { filters: sameSpan ?? filters, enabled: !!sameSpan });
  const top = artists.data?.items[0];
  return (
    <StatsFrame>
      <Hero o={ov.data} top={top} topLoading={!artists.data} prev={sameSpan ? lastOv.data?.est_s : ov.data?.previous.est_s} cmp={cmp}
            title={periodTitle(filters, meta.data?.today)} topMove={top ? rankMove(1, prevRank(top)) : null} />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        <SongsRow items={songs.data?.items as Music[] | undefined} prevRank={songsPrev.prevRank} cmp={songsPrev.cmp} />
        <div className="grid gap-12 xl:grid-cols-2">
          <ArtistsBand items={artists.data?.items} />
          <AlbumsBand />
        </div>
        <Evolution />
        <Records />
        <More />
      </main>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ o, top, topLoading, prev, cmp, title, topMove }: {
  o?: Overview; top?: RankedItem; topLoading: boolean; prev?: number | null; cmp: Comparison | null; title: string; topMove: Move | null;
}) {
  const q = useLinkQuery();
  const meta = useMeta().data;
  const accent = useAccent();
  const hours = o ? Math.round(o.est_s / 3600) : null;
  const change = o && cmp ? changeLine(o.est_s, prev, cmp.label) : null;
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 35%, ${accent} 150%)` }} />
      {/* sound-wave rings: our own mark for music, no artwork needed */}
      <div aria-hidden className="absolute -right-24 top-1/2 hidden -translate-y-1/2 lg:block">
        {[520, 420, 320].map((d, i) => (
          <span key={d} className="absolute rounded-full border-[18px]" style={{ width: d, height: d, top: -d / 2, right: (520 - d) / 2 - 260, borderColor: OV.paper, opacity: 0.05 + i * 0.03 }} />
        ))}
      </div>
      <div className="relative mx-auto flex min-h-[clamp(400px,58vh,600px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[640px] flex-col gap-5">
          <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "music"} · {title}</span>
          {o && hours != null ? (
            <>
              <h1 className="flex items-baseline gap-4 font-ov-display font-extrabold leading-[0.82]">
                <span className="text-[clamp(96px,13vw,190px)] tracking-[-0.05em]" style={{ color: OV.mustard }}>{num(hours)}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-[clamp(26px,2.6vw,38px)]">hours</span>
                  <span className="font-shelf-mono text-[12px] font-normal" style={{ color: OV.mute }}>of listening</span>
                </span>
              </h1>
              {change && <p className="text-[18px]">{change}</p>}
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Stat v={compact(o.videos)} l="streams" />
                <Stat v={compact(o.unique_videos)} l="different songs" />
                <Stat v={compact(o.unique_channels)} l="artists" />
                <Stat v={num(o.active_days)} l={`of ${num(o.days)} days`} />
              </dl>
            </>
          ) : <Skeleton h={240} dark />}
        </div>
        <div className="shrink-0 lg:w-[300px]">
          {top ? (
            <Link to={`/channel/${encodeURIComponent(top.key)}${q}`} className="group flex items-center gap-5 lg:flex-col lg:items-start">
              <span className="relative">
                <Pic src={top.avatar_url} name={top.title} size="clamp(110px,14vw,190px)" ring={OV.paper} />
                <span className="absolute -right-2 top-1 flex h-14 w-14 rotate-6 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                      style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }} aria-hidden>#1</span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className={kicker} style={{ color: OV.mustard }}>Your #1 artist</span>
                <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">
                  {topHeadline(top.title, topMove?.tone === "same" ? 1 : undefined)}
                </span>
                <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{hoursShort(top.time_s)} · {streams(top.count)}</span>
              </span>
            </Link>
          ) : topLoading ? <Skeleton h={200} dark /> : null}
        </div>
      </div>
    </section>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{l}</dt>
      <dd className="order-1 font-ov-display text-[30px] font-extrabold leading-tight">{v}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ top songs, artists, albums

function SongsRow({ items, prevRank, cmp }: { items?: Music[]; prevRank: (c: RankedItem) => number | null | undefined; cmp: Comparison | null }) {
  const q = useLinkQuery();
  return (
    <Band label={`By streams${cmp ? ` · arrows since ${cmp.label}` : ""}`} title="Your top 10 songs" link={["/top/videos", "All your songs"]}>
      {!items ? <Skeleton h={260} /> : !items.length ? <p style={{ color: OV.soft }}>No songs in this period.</p> : (
        <ScrollRow key={q} outer="-mx-4 sm:mx-0" className="snap-x px-4 sm:px-0 lg:overflow-visible">
          <ol className="flex gap-4 pb-2 pt-2 lg:grid lg:grid-cols-10">
            {items.map((c) => (
              <li key={c.key} className="w-[140px] shrink-0 snap-start lg:w-auto lg:min-w-0">
                <Link to={songLink(c.key) + q} className="group flex flex-col items-start gap-2">
                  <span className="relative w-full">
                    <Cover src={c.thumb ?? c.cover} name={c.title} size="100%" className="aspect-square" />
                    <span className="absolute -left-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                          style={{ background: c.rank === 1 ? OV.mustard : OV.paper, borderColor: OV.ink }} aria-hidden>{c.rank}</span>
                  </span>
                  <span className="flex w-full flex-col">
                    <span className="truncate text-[15px] font-bold group-hover:underline">{c.title}</span>
                    <span className="truncate text-[13px]" style={{ color: OV.soft }}>{c.channel}</span>
                  </span>
                  <span className="font-ov-display text-[17px] font-extrabold leading-tight">{streams(c.count)}</span>
                  <MoveBadge m={rankMove(c.rank, prevRank(c))} />
                </Link>
              </li>
            ))}
          </ol>
        </ScrollRow>
      )}
    </Band>
  );
}

function ArtistsBand({ items }: { items?: RankedItem[] }) {
  const q = useLinkQuery();
  return (
    <Band label="By hours listened" title="Top artists" link={["/top/channels", "All your artists"]}>
      {!items ? <Skeleton h={220} /> : (
        <ol className="flex flex-col">
          {items.slice(0, 6).map((c) => (
            <RowLink key={c.key} to={`/channel/${encodeURIComponent(c.key)}${q}`} rank={c.rank}
                     pic={<Pic src={c.avatar_url} name={c.title} size="48px" />} title={c.title} sub={streams(c.count)} value={hoursShort(c.time_s)}
                     share={c.time_s / Math.max(1, items[0].time_s)} />
          ))}
        </ol>
      )}
    </Band>
  );
}

function AlbumsBand() {
  const q = useLinkQuery();
  const { filters } = useFilters();
  const albums = useStats<{ items: Music[] }>("top/albums", { limit: 6 }, { filters: { ...filters, metric: "time" } });
  const items = albums.data?.items;
  return (
    <Band label="By hours listened" title="Top albums" link={["/top/albums", "All your albums"]}>
      {!items ? <Skeleton h={220} /> : !items.length ? <p style={{ color: OV.soft }}>No albums in this period.</p> : (
        <ol className="flex flex-col">
          {items.map((a) => (
            <RowLink key={a.key} to={`/album/${encodeURIComponent(a.key)}${q}`} rank={a.rank}
                     pic={<Cover src={a.cover} name={a.title} size="48px" className="!border-2" />} title={a.title} sub={a.artist ?? ""}
                     value={hoursShort(a.time_s)} share={a.time_s / Math.max(1, items[0].time_s)} />
          ))}
        </ol>
      )}
    </Band>
  );
}

function RowLink({ to, rank, pic, title, sub, value, share }: {
  to: string; rank: number; pic: ReactNode; title?: string | null; sub: string; value: string; share: number;
}) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        <span className="w-6 shrink-0 text-right font-ov-display text-[16px] font-extrabold">{rank}</span>
        {pic}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[15px] font-bold">{title ?? "Unknown"}</span>
          <span className="flex items-center gap-2">
            <span className="block h-2 w-[45%] overflow-hidden rounded-full" style={{ background: OV.sand }}>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(3, share * 100)}%`, background: rank === 1 ? OV.mustard : OV.ink }} />
            </span>
            <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{sub}</span>
          </span>
        </span>
        <span className="shrink-0 font-ov-display text-[16px] font-extrabold">{value}</span>
      </Link>
    </li>
  );
}

// ------------------------------------------------------------------ evolution, records, more

function Evolution() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const years = yearsToShow(filters, meta?.first_date, meta?.today);
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: { ...filters, range: "all", metric: "time" }, enabled: !!years });
  if (!years) return null;
  const rows = tops.data?.filter((t) => years.includes(t.year));
  return (
    <Band label="Your #1 artist each year" title={rows ? reignTitle(rows) : "Your #1 each year"} link={["/evolution", "See how it changed"]}>
      {!rows ? <Skeleton h={160} /> : <ReignTimeline rows={rows} calendarYears={filters.range === "custom"} />}
    </Band>
  );
}

function Records() {
  const q = useLinkQuery();
  const rec = useStats<RecordsResponse>("records");
  const music = useStats<MusicRecords>("music/records");
  const s = rec.data?.streaks.longest;
  const d = rec.data?.biggest_day.by_count;
  const r = music.data?.on_repeat;
  return (
    <Band label="Records · your personal bests" title={r ? `${r.title}, ${num(r.count)} times in one day.` : "Your records"} link={["/records", "All your records"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card to={r ? songLink(r.key) + q : undefined} label="On repeat" bg={OV.mustard} loading={!music.data}
              big={r ? `${num(r.count)}× in a day` : "–"} line={r ? <><strong>{r.title}</strong> by {r.artist}, {date(r.date)}</> : "No song twice in one day here."}
              pic={r ? <Cover src={r.cover} name={r.title} size="64px" /> : undefined} />
        <Card to={`/records${q}`} label="Longest streak" bg={OV.teal} fg={OV.paper} loading={!rec.data}
              big={s ? `${num(s.days)} days in a row` : "–"} line={s ? `${spanLabel(s.start, s.end)}, music every day` : "Not enough data yet."} />
        <Card to={`/records${q}`} label="Biggest day" bg={OV.paper} loading={!rec.data}
              big={d ? streams(d.count) : "–"} line={d ? `on ${date(d.date)}` : "Nothing in this period."} />
      </div>
    </Band>
  );
}

function Card({ to, label, big, line, bg, fg = OV.ink, pic, loading }: {
  to?: string; label: string; big: string; line: ReactNode; bg: string; fg?: string; pic?: ReactNode; loading: boolean;
}) {
  const body = (
    <>
      <span className={kicker}>{label}</span>
      {loading ? <Skeleton h={72} /> : (
        <span className="flex items-center gap-4">
          {pic}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-ov-display text-[clamp(24px,2.4vw,32px)] font-extrabold leading-tight">{big}</span>
            <span className="text-[14px]">{line}</span>
          </span>
        </span>
      )}
    </>
  );
  const cls = "flex flex-col gap-3 rounded-2xl border-2 p-5";
  const style = { background: bg, color: fg, borderColor: OV.ink };
  return to ? <Link to={to} className={`${cls} transition-transform hover:-translate-y-0.5`} style={style}>{body}</Link>
            : <div className={cls} style={style}>{body}</div>;
}

function More() {
  const q = useLinkQuery();
  const clock = useStats<{ data: HourPoint[] }>("patterns/clock");
  const genres = useCapability("genres");
  const g = useStats<TopResponse>("top/genres", { limit: 1 }, { enabled: genres });
  const f = clock.data ? clockFacts(clock.data.data) : null;
  const card = "flex flex-col gap-3 rounded-2xl border-2 p-5 transition-transform hover:-translate-y-0.5";
  return (
    <Band label="More to explore" title="A few more things">
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to={`/patterns${q}`} className={card} style={{ background: OV.paper, borderColor: OV.ink }}>
          <span className="flex justify-between"><span className={kicker}>Patterns</span><span aria-hidden>›</span></span>
          {!clock.data ? <Skeleton h={60} /> : f ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{hourLabel(f.peak)}</span>
              <span className="text-[14px]">is when you listen most. See your days, hours and every day.</span>
            </span>
          ) : <span className="text-[14px]">When you listen.</span>}
        </Link>
        <Link to={genres ? `/top/genres${q}` : `/evolution${q}`} className={card} style={{ background: OV.mustard, borderColor: OV.ink }}>
          <span className="flex justify-between"><span className={kicker}>{genres ? "Top genres" : "Evolution"}</span><span aria-hidden>›</span></span>
          {genres && g.data?.items[0] ? (
            <span className="flex flex-col gap-1">
              <span className="font-ov-display text-[26px] font-extrabold leading-tight">{g.data.items[0].title}</span>
              <span className="text-[14px]">in {Math.round(g.data.items[0].share * 100)}% of what you played</span>
            </span>
          ) : <span className="text-[14px]">How your taste changed over the years: your #1 each year, the bar race, and who you found when.</span>}
        </Link>
      </div>
    </Band>
  );
}
