/* Detail pages in the new look: one channel, one video, a genre or category, one year. Same parts everywhere:
   a slim dark header with the picture, a row of key numbers, then cards (top videos, over time, when you watch). */
import { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Link, useCapability, usePlatform } from "../platform";
import { HourPoint, MonthPoint, Overview, RankedItem, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { clockTime, compact, date, duration, num, pct, safeHref } from "../format";
import { Cover, OV, Pic, Skeleton, StatsFrame, kicker, useCreator, useFamily, useNoun, useTime, useVerb } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { changeLine, hourLabel, hoursShort, periodTitle } from "./takeaways";

interface SubsetTotals { videos: number; unique_videos: number; est_s: number; first_watched: string | null; last_watched: string | null; active_days: number }
interface SubsetBase { in_range: SubsetTotals; all_time: SubsetTotals; top_videos: RankedItem[]; monthly: MonthPoint[]; clock: HourPoint[] }

// ------------------------------------------------------------------ shared parts

function Header({ image, label, title, lines, action }: { image: ReactNode; label: string; title: ReactNode; lines: ReactNode[]; action?: ReactNode }) {
  return (
    <section style={{ background: OV.ink, color: OV.paper }}>
      <div className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 px-4 py-9 sm:flex-row sm:items-end sm:px-8">
        {image}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={kicker} style={{ color: OV.mustard }}>{label}</span>
          <h1 className="break-words font-ov-display text-[clamp(30px,4vw,52px)] font-extrabold leading-[1.02] tracking-[-0.02em]">{title}</h1>
          {lines.filter(Boolean).map((l, i) => <p key={i} className="text-[15px]" style={{ color: OV.mute }}>{l}</p>)}
        </div>
        {action}
      </div>
    </section>
  );
}

function ExternalButton({ href, label }: { href: string; label: string }) {
  const safe = safeHref(href); // links come from imported data: http(s) only
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-10 shrink-0 items-center rounded-[10px] border-2 px-4 text-[14px] font-bold hover:bg-white/10"
       style={{ borderColor: "#4A433B", color: OV.paper }}>
      {label} ↗
    </a>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 pb-16 pt-8 sm:px-8">{children}</main>;
}

function Numbers({ items }: { items: [string, ReactNode, ReactNode?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([l, v, hint]) => (
        <div key={l} className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3" style={{ background: OV.paper, borderColor: OV.ink }}>
          <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: OV.soft }}>{l}</dt>
          <dd className="m-0 font-ov-display text-[26px] font-extrabold leading-tight">{v}</dd>
          {hint && <dd className="m-0 text-[12px]" style={{ color: OV.soft }}>{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Card({ label, title, children, className = "" }: { label: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6 ${className}`} style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        {title && <h2 className="font-ov-display text-[24px] font-extrabold leading-tight">{title}</h2>}
      </div>
      {children}
    </section>
  );
}

const thumbOf = (v: RankedItem) => v.thumb ?? (v.key && !v.key.includes(":") ? `https://i.ytimg.com/vi/${v.key}/mqdefault.jpg` : null);

function VideoList({ items, empty = "Nothing in this period." }: { items: RankedItem[]; empty?: string }) {
  const q = useLinkQuery();
  const music = useFamily() === "music";
  if (!items.length) return <p style={{ color: OV.soft }}>{empty}</p>;
  return (
    <ol className="flex flex-col">
      {items.map((v, i) => (
        <li key={v.key}>
          <Link to={`/video/${encodeURIComponent(v.key)}${q}`} className="flex items-center gap-3 border-b py-2 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
            <span className="w-5 text-right font-ov-display text-[14px] font-extrabold">{i + 1}</span>
            {music ? <Cover src={v.thumb} name={v.title} size="44px" className="!border-2" />
             : thumbOf(v) ? <img src={thumbOf(v)!} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-[88px] shrink-0 rounded border object-cover" style={{ borderColor: OV.ink }} />
                        : <span className="aspect-video w-[88px] shrink-0 rounded" style={{ background: OV.sand }} />}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="line-clamp-2 text-[14px] font-bold leading-snug">{v.title ?? "Unavailable video"}</span>
              {v.channel && <span className="truncate text-[12px]" style={{ color: OV.soft }}>{v.channel}</span>}
            </span>
            <span className="shrink-0 text-right font-shelf-mono text-[12px]">{v.count > 1 ? `${num(v.count)}×` : duration(v.time_s)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function FaceRow({ items }: { items: RankedItem[] }) {
  const tm = useTime();
  const q = useLinkQuery();
  const n = useNoun().many;
  if (!items.length) return <p style={{ color: OV.soft }}>Nothing in this period.</p>;
  return (
    <ol className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-10">
      {items.slice(0, 10).map((c) => (
        <li key={c.key} className="min-w-0">
          <Link to={`/channel/${encodeURIComponent(c.key)}${q}`} className="group flex flex-col items-center gap-1 text-center">
            <Pic src={c.avatar_url} name={c.title} size="72px" />
            <span className="w-full truncate text-[13px] font-bold group-hover:underline">{c.title}</span>
            <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{tm.unit === "minutes" || c.time_s >= 3600 ? tm.fmt(c.time_s) : duration(c.time_s)} · {num(c.count)} {n}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** Months between the first and last with data, empty months filled so gaps show. */
function fillMonths(data: MonthPoint[]): MonthPoint[] {
  if (!data.length) return data;
  const got = new Map(data.map((m) => [m.month, m]));
  const out: MonthPoint[] = [];
  let [y, m] = data[0].month.split("-").map(Number);
  const [ey, em] = data[data.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(got.get(key) ?? { month: key, count: 0, time_s: 0 });
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

/** What the counts count: streams (music), play days (games, one per game per day), else the platform's items. */
function useCountWord(): string {
  const fam = useFamily();
  const n = useNoun().many;
  return fam === "music" ? "streams" : fam === "games" ? "play days" : n;
}

function MonthBars({ data }: { data: MonthPoint[] }) {
  const n = useCountWord();
  const tm = useTime();
  const months = fillMonths(data);
  if (!months.length) return <p style={{ color: OV.soft }}>Nothing yet.</p>;
  const many = months.length > 24;
  const label = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <HoverBars height={150} gap={2} radius={2} hint="Hover a month to see it." ariaLabel="Hours per month"
               bars={months.map((x) => ({ key: x.month, label: label(x.month), value: x.time_s, display: `${tm.fmt(x.time_s)} · ${num(x.count)} ${n}`, color: OV.ink }))}
               ticks={<Ticks labels={months.map((x) => (many ? (x.month.endsWith("-01") ? x.month.slice(0, 4) : "")
                                                            : new Date(x.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })))} />} />
  );
}

function ClockBars({ data }: { data: HourPoint[] }) {
  const n = useCountWord();
  const total = data.reduce((s, h) => s + h.count, 0);
  if (!total) return <p style={{ color: OV.soft }}>Nothing in this period.</p>;
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a)).hour;
  return (
    <HoverBars height={120} hint={`${hourLabel(peak)} is the busiest hour. Hover one to see it.`} ariaLabel={`By hour of day. Busiest: ${hourLabel(peak)}.`}
               bars={data.map((h) => ({ key: String(h.hour), label: `${hourLabel(h.hour)} to ${hourLabel((h.hour + 1) % 24)}`, value: h.count,
                                        display: `${num(h.count)} ${n}`, color: h.hour === peak ? OV.teal : "#CDBFA6" }))}
               ticks={<Ticks labels={["12 AM", "6 AM", "12 PM", "6 PM"]} />} />
  );
}

function OverTime({ d, monthsLabel }: { d: SubsetBase; monthsLabel?: string }) {
  const tm = useTime();
  monthsLabel = monthsLabel ?? `Over time · all time, ${tm.unit} per month`;
  const { verb } = useVerb();
  const hasTimes = useCapability("time_of_day");
  return (
    <div className={`grid gap-4 ${hasTimes ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
      <Card label={monthsLabel}><MonthBars data={d.monthly} /></Card>
      {hasTimes && <Card label={`When you ${verb} · this period`}><ClockBars data={d.clock} /></Card>}
    </div>
  );
}

function Chips({ items, to }: { items: string[]; to?: (s: string) => string }) {
  const q = useLinkQuery();
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => to
        ? <Link key={t} to={to(t) + q} className="rounded-full border-2 px-3 py-1 text-[13px] hover:bg-black/[0.04]" style={{ borderColor: OV.ink }}>{t}</Link>
        : <span key={t} className="rounded-full border px-3 py-1 text-[13px]" style={{ borderColor: "#CDBFA6" }}>{t}</span>)}
    </div>
  );
}

/** Hours, how many, first and last time: in the platform's words (videos watched, streams listened…). */
function useSubsetNumbers(d: SubsetBase | undefined, range: string): [string, ReactNode, ReactNode?][] {
  const tm = useTime();
  const n = useNoun();
  const fam = useFamily();
  const music = fam === "music";
  const { verbed } = useVerb();
  if (!d) return [];
  const all = range === "all";
  return [
    [tm.Unit, tm.fmt(d.in_range.est_s), all ? undefined : `${tm.fmt(d.all_time.est_s)} all time`],
    fam === "games" ? [n.Many, num(d.in_range.unique_videos), all ? undefined : `${num(d.all_time.unique_videos)} all time`]
                    : [music ? "Streams" : n.Many, num(d.in_range.videos), all ? undefined : `${num(d.all_time.videos)} all time`],
    [`First ${verbed}`, date(d.all_time.first_watched)],
    [`Last ${verbed}`, date(d.all_time.last_watched)],
  ];
}

function Loading() {
  return <StatsFrame><div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-8"><Skeleton h={400} /></div></StatsFrame>;
}

// ------------------------------------------------------------------ channel

interface ChannelDetail extends SubsetBase {
  channel: { channel_id: string; title: string | null; handle?: string | null; avatar_url?: string | null; subscriber_count?: number | null;
             video_count?: number | null; country?: string | null; created_at?: string | null; topics: string[] };
  url: string;
  rank_history: { year: number; rank: number; count: number; channels_that_year: number }[];
}

export function ChannelDetailPage() {
  const { id = "" } = useParams();
  const { filters } = useFilters();
  const name = usePlatform()?.name ?? "YouTube";
  const d = useStats<ChannelDetail>(`channel/${encodeURIComponent(id)}`);
  const c = d.data;
  const cr = useCreator();
  const n = useNoun();
  const numbers = useSubsetNumbers(c, filters.range);
  if (!c) return d.error ? <StatsFrame><p className="p-8">Not found.</p></StatsFrame> : <Loading />;
  const best = c.rank_history.reduce<ChannelDetail["rank_history"][number] | null>((a, b) => (!a || b.rank < a.rank ? b : a), null);
  return (
    <StatsFrame>
      <Header image={<Pic src={c.channel.avatar_url} name={c.channel.title} size="120px" ring={OV.paper} />} label={cr.one.charAt(0).toUpperCase() + cr.one.slice(1)}
              title={c.channel.title ?? "Unknown"}
              lines={[[c.channel.handle, c.channel.subscriber_count != null && `${compact(c.channel.subscriber_count)} subscribers`,
                       c.channel.video_count != null && `${num(c.channel.video_count)} uploads`].filter(Boolean).join(" · "),
                      best ? `At its best your #${num(best.rank)} ${cr.one}, in ${best.year}.` : ""]}
              action={<ExternalButton href={c.url} label={`Find on ${name}`} />} />
      <Body>
        <Numbers items={numbers} />
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card label={`Your top ${n.many} from them · ${periodTitle(filters, undefined)}`}><VideoList items={c.top_videos.slice(0, 10)} /></Card>
          <Card label={`Its rank among your ${cr.many}, each year`}>
            {!c.rank_history.length ? <p style={{ color: OV.soft }}>No history.</p> : (
              <ol className="flex flex-col">
                {c.rank_history.map((r) => (
                  <li key={r.year} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "#E0D5C1" }}>
                    <span className="w-12 font-shelf-mono text-[13px]">{r.year}</span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full" style={{ background: OV.sand }}>
                      {/* closer to #1 = longer bar (log scale: #3 vs #12 matters as much as #300 vs #1,200) */}
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (1 - Math.log10(r.rank) / Math.log10(Math.max(10, r.channels_that_year))) * 100)}%`,
                                                                             background: r.rank === best?.rank ? OV.accent : OV.ink }} />
                    </span>
                    <span className="w-[120px] text-right text-[13px]"><strong className="font-ov-display text-[16px]">#{num(r.rank)}</strong> of {compact(r.channels_that_year)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <OverTime d={c} />
        {c.channel.topics.length > 0 && <Card label="Genres"><Chips items={c.channel.topics} to={(t) => `/genre/${encodeURIComponent(t)}`} /></Card>}
      </Body>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ video

interface VideoDetail {
  video: { video_id: string; status: string; title: string | null; channel_id: string | null; channel_title: string | null; published_at?: string | null;
           duration_s?: number | null; category?: string | null; tags: string[]; topics: string[]; thumb_large?: string | null;
           view_count?: number | null; like_count?: number | null; bucket?: string; is_background?: number; is_live?: number };
  url: string;
  watch_count: number;
  total_est_s: number;
  watches: { entry_id: number; local_iso: string; est_s: number; delayed_fix: number }[];
}

export function VideoDetailPage() {
  const { id = "" } = useParams();
  const q = useLinkQuery();
  const name = usePlatform()?.name ?? "YouTube";
  const hasTimes = useCapability("time_of_day");
  const d = useStats<VideoDetail>(`video/${encodeURIComponent(id)}`);
  const v = d.data;
  const music = useFamily() === "music";
  const n = useNoun();
  const { verbed } = useVerb();
  if (!v) return d.error ? <StatsFrame><p className="p-8">Not found.</p></StatsFrame> : <Loading />;
  const gone = v.video.status !== "ok";
  const short = v.video.bucket === "short";
  const img = gone ? null : v.video.thumb_large ?? (music ? null : `https://i.ytimg.com/vi/${v.video.video_id}/hqdefault.jpg`);
  const title = v.video.title && !v.video.title.startsWith("http") ? v.video.title : `Unavailable ${n.one}`;
  return (
    <StatsFrame>
      <Header label={music ? "Track" : short ? "Short" : v.video.is_live ? "Live stream" : "Video"} title={title}
              image={music ? <Cover src={img} name={title} size="180px" ring={OV.paper} />
                     : img ? <img src={img} alt="" referrerPolicy="no-referrer" className={`shrink-0 rounded-xl border-2 object-cover ${short ? "aspect-[9/16] w-[130px]" : "aspect-video w-[300px]"}`} style={{ borderColor: OV.paper }} />
                         : <span className="flex aspect-video w-[300px] shrink-0 items-center justify-center rounded-xl border-2 p-4 text-center text-[13px]" style={{ borderColor: "#4A433B", color: OV.mute }}>Removed or private. Your history still remembers it.</span>}
              lines={[v.video.channel_id ? <Link to={`/channel/${encodeURIComponent(v.video.channel_id)}${q}`} className="underline underline-offset-4" style={{ color: OV.paper }}>{v.video.channel_title ?? "More"} ›</Link> : "",
                      [v.video.category, v.video.view_count != null && `${compact(v.video.view_count)} views`, v.video.like_count != null && `${compact(v.video.like_count)} likes`].filter(Boolean).join(" · ")]}
              action={<ExternalButton href={v.url} label={`Find on ${name}`} />} />
      <Body>
        <Numbers items={[[`You ${verbed} it`, `${num(v.watch_count)}×`], ["Time", duration(v.total_est_s)],
                         ["Length", v.video.duration_s ? duration(v.video.duration_s) : "–"],
                         music ? [`First ${verbed}`, date(v.watches[0]?.local_iso)] : ["Uploaded", date(v.video.published_at)]]} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card label={`Every time you ${verbed} it`} title={`${num(v.watch_count)} ${v.watch_count === 1 ? "time" : "times"}`}>
            <ol className="flex flex-col">
              {[...v.watches].reverse().map((w) => (
                <li key={w.entry_id} className="flex justify-between border-b py-2 text-[14px]" style={{ borderColor: "#E0D5C1" }}>
                  <span>{date(w.local_iso)}{hasTimes && <span style={{ color: OV.soft }}> · {clockTime(w.local_iso)}</span>}</span>
                  <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>~{duration(w.est_s)}</span>
                </li>
              ))}
            </ol>
          </Card>
          <div className="flex flex-col gap-4">
            {v.video.topics.length > 0 && <Card label="Genres"><Chips items={v.video.topics} to={(t) => `/genre/${encodeURIComponent(t)}`} /></Card>}
            {v.video.tags.length > 0 && <Card label="Tags"><Chips items={v.video.tags.slice(0, 40)} /></Card>}
          </div>
        </div>
      </Body>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ genre & category

interface GroupDetail extends SubsetBase { top_channels: RankedItem[] }

function GroupView({ title, label, d, external }: { title: string; label: string; d: GroupDetail; external?: string }) {
  const { filters } = useFilters();
  const cr = useCreator();
  const n = useNoun();
  const numbers = useSubsetNumbers(d, filters.range);
  const games = useFamily() === "games";
  return (
    <StatsFrame>
      <Header label={label} title={title}
              image={<span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 font-ov-display text-[44px] font-extrabold" style={{ background: OV.mustard, color: OV.ink, borderColor: OV.paper }}>{title.charAt(0)}</span>}
              lines={[games ? `${num(d.all_time.unique_videos)} ${n.many} · ${num(d.all_time.active_days)} days played, all time`
                            : `${num(d.all_time.videos)} ${n.many} all time · ${num(d.all_time.unique_videos)} different`]}
              action={external && <ExternalButton href={external} label="About on Wikipedia" />} />
      <Body>
        <Numbers items={numbers} />
        <Card label={`Top ${cr.many} · ${periodTitle(filters, undefined)}`}><FaceRow items={d.top_channels} /></Card>
        {!games && <Card label={`Top ${n.many} · ${periodTitle(filters, undefined)}`}><VideoList items={d.top_videos.slice(0, 10)} /></Card>}
        <OverTime d={d} />
      </Body>
    </StatsFrame>
  );
}

export function CategoryDetailPage() {
  const { id = "" } = useParams();
  const d = useStats<GroupDetail & { category: { title: string } }>(`category/${encodeURIComponent(id)}`);
  if (!d.data) return d.error ? <StatsFrame><p className="p-8">Category not found.</p></StatsFrame> : <Loading />;
  return <GroupView title={d.data.category.title} label="YouTube category" d={d.data} />;
}

export function GenreDetailPage() {
  const { topic = "" } = useParams();
  const d = useStats<GroupDetail & { genre: { title: string; url: string } }>(`genre/${encodeURIComponent(topic)}`);
  if (!d.data) return d.error ? <StatsFrame><p className="p-8">Genre not found.</p></StatsFrame> : <Loading />;
  return <GroupView title={d.data.genre.title} label="Genre" d={d.data} external={d.data.genre.url} />;
}

// ------------------------------------------------------------------ year

interface YearDetail {
  year: number; overview: Overview; top_channels: RankedItem[]; top_videos: RankedItem[]; top_genres: RankedItem[];
  new_discoveries: { channel_id: string; title?: string; avatar_url?: string | null; count: number; first_watched: string }[];
  monthly: MonthPoint[]; clock: HourPoint[];
}

export function YearDetailPage() {
  const cr = useCreator();
  const { verbed } = useVerb();
  const n = useNoun().many;
  const { year = "" } = useParams();
  const q = useLinkQuery();
  const name = usePlatform()?.name ?? "YouTube";
  const d = useStats<YearDetail>(`year/${year}`);
  const games = useFamily() === "games";
  const y = d.data;
  if (!y) return d.error ? <StatsFrame><p className="p-8">No data for that year.</p></StatsFrame> : <Loading />;
  const o = y.overview;
  const change = changeLine(o.est_s, o.previous.est_s, String(y.year - 1));
  return (
    <StatsFrame>
      <Header label={`Your year on ${name}`} title={`${y.year}: ${num(Math.round(o.est_s / 3600))} hours`}
              image={<span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 font-ov-display text-[30px] font-extrabold" style={{ background: OV.accent, color: OV.paper, borderColor: OV.paper }}>{String(y.year).slice(2)}</span>}
              lines={[`${games ? "" : `${num(o.videos)} ${n} · `}${num(o.unique_channels)} ${cr.many} · ${num(o.active_days)} days${change ? ` · ${change}` : ""}`]}
              action={<Link to={`/wrapped?year=${y.year}${q ? `&${q.slice(1)}` : ""}`} className="inline-flex min-h-10 shrink-0 items-center rounded-[10px] px-4 text-[15px] font-bold" style={{ background: OV.mustard, color: OV.ink }}>Open {y.year} Wrapped</Link>} />
      <Body>
        <Numbers items={[["Hours", hoursShort(o.est_s)], ...(games ? [] : [[n.charAt(0).toUpperCase() + n.slice(1), num(o.videos)] as [string, string]]), [cr.Many, num(o.unique_channels)], [`Days you ${verbed}`, pct(o.pct_days_active), `${num(o.active_days)} days`]]} />
        <Card label={`Top ${cr.many}`}><FaceRow items={y.top_channels} /></Card>
        <div className={`grid gap-4 ${games ? "" : "lg:grid-cols-[3fr_2fr]"}`}>
          {!games && <Card label={`Top ${n}`}><VideoList items={y.top_videos.slice(0, 10)} /></Card>}
          <Card label="Top genres">
            <ol className="flex flex-col">
              {y.top_genres.slice(0, 8).map((g) => (
                <li key={g.key}>
                  <Link to={`/genre/${encodeURIComponent(g.key)}${q}`} className="flex items-center gap-3 border-b py-2 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{g.title ?? g.key}</span>
                    <span className="h-2.5 w-[35%] overflow-hidden rounded-full" style={{ background: OV.sand }}><span className="block h-full" style={{ width: `${g.share * 100}%`, background: OV.ink }} /></span>
                    <span className="w-10 text-right font-shelf-mono text-[12px]">{pct(g.share)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        {y.new_discoveries.length > 0 && (
          <Card label={`New in ${y.year}`}>
            <ol className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-10">
              {y.new_discoveries.slice(0, 10).map((c) => (
                <li key={c.channel_id} className="min-w-0">
                  <Link to={`/channel/${encodeURIComponent(c.channel_id)}${q}`} className="group flex flex-col items-center gap-1 text-center">
                    <Pic src={c.avatar_url} name={c.title} size="64px" />
                    <span className="w-full truncate text-[13px] font-bold group-hover:underline">{c.title}</span>
                    <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{games ? `${num(c.count)} ${c.count === 1 ? "day" : "days"}` : `${num(c.count)} ${n}`}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}
        <OverTime d={{ monthly: y.monthly, clock: y.clock } as SubsetBase} monthsLabel={`${y.year}, hours per month`} />
      </Body>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ album (music)

interface AlbumDetail extends SubsetBase { album: { album_id: string; title: string | null; cover: string | null; released: string | null; artist_id: string | null; artist: string | null } }

export function AlbumDetailPage() {
  const { id = "" } = useParams();
  const { filters } = useFilters();
  const q = useLinkQuery();
  const d = useStats<AlbumDetail>(`album/${encodeURIComponent(id)}`);
  const a = d.data;
  const numbers = useSubsetNumbers(a, filters.range);
  if (!a) return d.error ? <StatsFrame><p className="p-8">Album not found.</p></StatsFrame> : <Loading />;
  return (
    <StatsFrame>
      <Header image={<Cover src={a.album.cover} name={a.album.title} size="140px" ring={OV.paper} />} label="Album"
              title={a.album.title ?? "Unknown album"}
              lines={[<>{a.album.artist_id ? <Link to={`/channel/${encodeURIComponent(a.album.artist_id)}${q}`} className="underline underline-offset-2">{a.album.artist}</Link> : a.album.artist}
                        {a.album.released ? ` · ${a.album.released.slice(0, 4)}` : ""}</>,
                      `${num(a.all_time.unique_videos)} of its songs played, ${num(a.all_time.videos)} streams all time`]} />
      <Body>
        <Numbers items={numbers} />
        <Card label={`Its songs you played · ${periodTitle(filters, undefined)}`}><VideoList items={a.top_videos} /></Card>
        <OverTime d={a} />
      </Body>
    </StatsFrame>
  );
}
