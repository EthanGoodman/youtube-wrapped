/* Records in the new look. Main: three big records (streak, biggest day, longest sitting). Secondary: moments with
   pictures (latest night, earliest morning, oldest video) and a row of smaller facts. Then your milestones. */
import { ReactNode } from "react";
import { Link, useCapability, usePlatform } from "../platform";
import { WatchInfo, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { clockTime, date, duration, num } from "../format";
import { OV, PageBody, PageHeader, Poster, ScrollRow, Skeleton, StatsFrame, kicker, useFamily, useNoun } from "./kit";
import { Binge, EpisodeDay } from "../families/shows/data";
import { periodTitle, spanLabel } from "./takeaways";

interface Streak { days: number; start: string | null; end: string | null }
interface Day { date: string; count: number; time_s: number }
interface RecordsResponse {
  biggest_day: { by_count: Day | null; by_time: Day | null };
  longest_session: { videos: number; time_s: number; span_s: number; start: string; top_channel: string | null } | null;
  streaks: { longest: Streak | null; current: Streak; longest_break: Streak | null };
  latest_night: WatchInfo | null;
  earliest_morning: WatchInfo | null;
  channel_day: { date: string; channel_id: string; channel: string; count: number } | null;
  oldest: (WatchInfo & { published_at: string }) | null;
  early_bird_count: number;
  fastest: (WatchInfo & { seconds_after_upload: number }) | null;
  counts: { ads: number; unavailable: number; surveys: number };
}
type Milestone = WatchInfo & { n: number };

const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);
const span = (s: Streak | null) => (s?.start && s.end ? spanLabel(s.start, s.end) : "");

export function RecordsPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const rec = useStats<RecordsResponse>("records");
  const ms = useStats<Milestone[]>("milestones");
  const r = rec.data;
  const family = useFamily();
  const title = !r ? "Your records" : r.streaks.longest ? `${days(r.streaks.longest.days)} in a row.` : "Your records";
  return (
    <StatsFrame>
      <PageHeader label={`Records · ${periodTitle(filters, meta?.today)}`} title={title}>
        {r?.streaks.longest && <p className="text-[17px]" style={{ color: OV.mute }}>Your longest streak, {span(r.streaks.longest)}.</p>}
      </PageHeader>
      <PageBody>
        {!r ? <Skeleton h={300} /> : (
          <>
            <BigRecords r={r} />
            {family === "shows" ? <ShowMoments /> : <Moments r={r} />}
            <SmallFacts r={r} />
          </>
        )}
        <Milestones items={ms.data} />
      </PageBody>
    </StatsFrame>
  );
}

function Big({ label, value, detail, bg, fg = OV.ink, children }: {
  label: string; value: string; detail: ReactNode; bg: string; fg?: string; children?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 p-6" style={{ background: bg, color: fg, borderColor: OV.ink }}>
      <span className={kicker}>{label}</span>
      <span className="font-ov-display text-[clamp(36px,3.6vw,52px)] font-extrabold leading-none">{value}</span>
      <span className="text-[15px] leading-snug">{detail}</span>
      {children && <div className="mt-auto pt-3">{children}</div>}
    </section>
  );
}

function BigRecords({ r }: { r: RecordsResponse }) {
  const n = useNoun();
  const ov = useStats<{ active_days: number; days: number }>("overview");
  const hasTimes = useCapability("time_of_day");
  const s = r.streaks.longest;
  const d = r.biggest_day.by_count;
  const t = r.biggest_day.by_time;
  const l = hasTimes ? r.longest_session : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Big label="Longest streak" bg={OV.teal} fg={OV.paper} value={s ? days(s.days) : "None yet"} detail={s ? `in a row, ${span(s)}` : "Watch two days in a row to start one."}>
        {s && (
          <span aria-hidden className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(14,minmax(0,1fr))" }}>
            {Array.from({ length: 28 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[2px]" style={{ background: i < Math.min(s.days, 28) ? OV.mustard : "rgba(251,246,236,0.22)" }} />
            ))}
          </span>
        )}
      </Big>
      <Big label="Biggest day" bg={OV.mustard} value={d ? `${num(d.count)} ${d.count === 1 ? n.one : n.many}` : "–"}
           detail={d ? <>on {date(d.date)}{t && t.date !== d.date ? <>. Most time in a day: <strong>{duration(t.time_s)}</strong> on {date(t.date)}.</> : <>, {duration(d.time_s)} of watching.</>}</> : "Nothing in this period."} />
      {/* without times there are no sittings: how many days you watched at all instead */}
      {!l && ov.data ? (
        <Big label="Days you watched" bg={OV.paper} value={num(ov.data.active_days)}
             detail={`of ${num(ov.data.days)} days, ${Math.round((ov.data.active_days / Math.max(1, ov.data.days)) * 100)}% of them`} />
      ) : <Big label="Longest sitting" bg={OV.paper} value={l ? duration(l.time_s) : "–"}
           detail={l ? <>{num(l.videos)} {l.videos === 1 ? n.one : n.many} without a 30-minute break, {date(l.start)}{l.top_channel ? <>, mostly <strong>{l.top_channel}</strong></> : ""}.</> : "Nothing in this period."} />}
    </div>
  );
}

/** Shows: the records a show set, with its poster. */
function ShowMoments() {
  const q = useLinkQuery();
  const binge = useStats<{ data: Binge[] }>("shows/binges", { limit: 1 });
  const day = useStats<{ data: EpisodeDay[] }>("shows/days", { limit: 1 });
  const b = binge.data?.data[0];
  const e = day.data?.data[0];
  const card = (label: string, big: string, line: ReactNode, poster: string | null | undefined, name: string, to: string) => (
    <Link to={to + q} className="group flex min-w-0 items-center gap-5 rounded-2xl border-2 p-5 transition-transform hover:-translate-y-0.5"
          style={{ background: OV.paper, borderColor: OV.ink }}>
      <Poster src={poster} name={name} width="84px" />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        <span className="font-ov-display text-[clamp(30px,3vw,42px)] font-extrabold leading-none">{big}</span>
        <span className="text-[15px]">{line}</span>
      </span>
    </Link>
  );
  if (!binge.data || !day.data) return <Skeleton h={160} />;
  if (!b && !e) return null;
  return (
    <section className="flex flex-col gap-3">
      <span className={kicker} style={{ color: OV.soft }}>Set by a show</span>
      <div className="grid gap-4 md:grid-cols-2">
        {b && card("Fastest season", days(b.days), <><strong>{b.title}</strong>, season {b.season}: {num(b.episodes)} episodes, {spanLabel(b.start, b.end)}</>,
                   b.avatar_url, b.title, `/channel/${encodeURIComponent(b.key)}`)}
        {e && card("One show, one day", `${num(e.episodes)} episodes`, <><strong>{e.title}</strong> on {date(e.date)}</>,
                   e.avatar_url, e.title, `/channel/${encodeURIComponent(e.key)}`)}
      </div>
    </section>
  );
}

function Moment({ label, big, sub, w }: { label: string; big: string; sub: string; w: WatchInfo | null }) {
  const q = useLinkQuery();
  if (!w) return null;
  const thumb = w.thumb ?? (w.video_id ? `https://i.ytimg.com/vi/${w.video_id}/mqdefault.jpg` : null);
  return (
    <Link to={w.video_id ? `/video/${w.video_id}${q}` : "#"} className="group flex min-w-0 flex-col gap-3 rounded-2xl border-2 p-5 transition-transform hover:-translate-y-0.5"
          style={{ background: OV.paper, borderColor: OV.ink }}>
      <span className={kicker} style={{ color: OV.soft }}>{label}</span>
      <span><span className="font-ov-display text-[34px] font-extrabold leading-none">{big}</span>
        <span className="ml-2 text-[14px]" style={{ color: OV.soft }}>{sub}</span></span>
      <span className="flex items-center gap-3">
        {thumb && <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-[120px] shrink-0 rounded-md border-2 object-cover" style={{ borderColor: OV.ink }} />}
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 text-[14px] font-bold leading-snug group-hover:underline">{w.title ?? "Unavailable video"}</span>
          <span className="truncate text-[12px]" style={{ color: OV.soft }}>{w.channel}</span>
        </span>
      </span>
    </Link>
  );
}

function Moments({ r }: { r: RecordsResponse }) {
  const hasTimes = useCapability("time_of_day");
  const isYouTube = (usePlatform()?.id ?? "youtube") === "youtube";
  const items = [
    hasTimes && r.latest_night && <Moment key="n" label="Latest night" big={clockTime(r.latest_night.local_iso)} sub={date(r.latest_night.local_iso)} w={r.latest_night} />,
    hasTimes && r.earliest_morning && <Moment key="m" label="Earliest morning" big={clockTime(r.earliest_morning.local_iso)} sub={date(r.earliest_morning.local_iso)} w={r.earliest_morning} />,
    isYouTube && r.oldest && <Moment key="o" label="Oldest video you watched" big={r.oldest.published_at.slice(0, 4)} sub={`uploaded ${date(r.oldest.published_at)}`} w={r.oldest} />,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <span className={kicker} style={{ color: OV.soft }}>Moments</span>
      <div className="grid gap-4 md:grid-cols-3">{items}</div>
    </section>
  );
}

function SmallFacts({ r }: { r: RecordsResponse }) {
  const q = useLinkQuery();
  const isYouTube = (usePlatform()?.id ?? "youtube") === "youtube";
  const shows = useFamily() === "shows";
  const facts: [string, ReactNode, ReactNode][] = [
    ["Current streak", days(r.streaks.current.days), r.streaks.current.days ? `since ${date(r.streaks.current.start ?? "")}` : "nothing going right now"],
    ["Longest break", r.streaks.longest_break ? days(r.streaks.longest_break.days) : "None", span(r.streaks.longest_break)],
  ];
  if (r.channel_day && !shows) facts.push(["One channel, one day", `${num(r.channel_day.count)} videos`,
    <><Link to={`/channel/${encodeURIComponent(r.channel_day.channel_id)}${q}`} className="underline underline-offset-2">{r.channel_day.channel}</Link> on {date(r.channel_day.date)}</>]);
  if (isYouTube) facts.push(["Early bird", `${num(r.early_bird_count)} videos`,
    r.fastest ? `within an hour of upload; fastest ${duration(r.fastest.seconds_after_upload)} after` : "within an hour of upload"]);
  return (
    <section className="flex flex-col gap-3">
      <span className={kicker} style={{ color: OV.soft }}>More records</span>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([l, v, d]) => (
          <div key={l} className="flex flex-col gap-1 rounded-xl border px-4 py-3" style={{ borderColor: "#D9CDB6" }}>
            <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: OV.soft }}>{l}</dt>
            <dd className="m-0 font-ov-display text-[22px] font-extrabold leading-tight">{v}</dd>
            <dd className="m-0 text-[13px]" style={{ color: OV.soft }}>{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Milestones({ items }: { items?: Milestone[] }) {
  const q = useLinkQuery();
  const n = useNoun();
  if (!items) return <Skeleton h={200} />;
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>Milestones · all time</span>
        <h2 className="font-ov-display text-[clamp(26px,3vw,36px)] font-extrabold leading-tight">Your 1st, 1,000th and {num(items[items.length - 1].n)}th {n.one}</h2>
      </div>
      <ScrollRow outer="-mx-4 sm:mx-0" className="px-4 pb-2 sm:px-0">
        <ol className="relative flex w-max gap-4">
          {items.map((m, i) => {
            const thumb = m.thumb ?? (m.video_id && !m.video_id.includes(":") ? `https://i.ytimg.com/vi/${m.video_id}/mqdefault.jpg` : null);
            return (
              <li key={m.n} className="relative w-[200px] shrink-0">
                {/* the line runs from each milestone to the next (into the 16px gap), so it ends at the last one */}
                {i < items.length - 1 && <span aria-hidden className="absolute left-4 right-[-16px] top-[18px] h-[2px]" style={{ background: OV.ink }} />}
                <Link to={m.video_id ? `/video/${m.video_id}${q}` : "#"} className="group flex flex-col gap-2">
                  <span className="relative z-10 w-fit rounded-full border-2 px-3 py-1 font-ov-display text-[15px] font-extrabold"
                        style={{ background: OV.mustard, borderColor: OV.ink }}>#{num(m.n)}</span>
                  <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{date(m.local_iso)}</span>
                  {thumb && <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-full rounded-md border-2 object-cover" style={{ borderColor: OV.ink }} />}
                  <span className="line-clamp-2 text-[13px] font-bold leading-snug group-hover:underline">{m.title ?? `Unavailable ${n.one}`}</span>
                  <span className="truncate text-[12px]" style={{ color: OV.soft }}>{m.channel}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </ScrollRow>
    </section>
  );
}
