/* Records on Netflix: your personal bests as big tiles (with posters where a show set the record),
   and milestones along your history. */
import { ReactNode } from "react";
import { Film } from "lucide-react";
import { Overview, WatchInfo, useStats } from "../../api";
import { Link, useCapability } from "../../platform";
import { QueryState, Section, WatchTimeInfo } from "../../components/ui";
import { Binge, EpisodeDay, useShows } from "./data";
import { PageHead, Poster, RED, plural } from "./ui";
import { clockTime, date, duration, num, pct } from "../../format";
import { rangeLabel, useFilters, useLinkQuery } from "../../filters";

interface Streak { days: number; start: string | null; end: string | null }
interface RecordsResponse {
  biggest_day: { by_count: { date: string; count: number; time_s: number } | null; by_time: { date: string; count: number; time_s: number } | null };
  longest_session: { videos: number; time_s: number; span_s: number; start: string; top_channel: string | null } | null;
  streaks: { longest: Streak | null; current: Streak; longest_break: Streak | null };
  latest_night: WatchInfo | null;
  earliest_morning: WatchInfo | null;
}
type Milestone = WatchInfo & { n: number };

export function ShowsRecords() {
  const { filters } = useFilters();
  const hasTimes = useCapability("time_of_day");
  const rec = useStats<RecordsResponse>("records");
  const ov = useStats<Overview>("overview");
  const ms = useStats<Milestone[]>("milestones");
  const binge = useShows<Binge[]>("binges", { limit: 1 });
  const day = useShows<EpisodeDay[]>("days", { limit: 1 });
  const b = binge.data?.data[0];
  const e = day.data?.data[0];
  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Records" subtitle={`Your personal bests, from ${rangeLabel(filters)}`} />

      {/* the show-made records, with their posters */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ShowRecord label="Fastest season" poster={b?.avatar_url} to={b && `/channel/${b.key}`}
                    value={b ? plural(b.days, "day") : "–"}
                    detail={b ? <><b className="text-white">{b.title}</b> · Season {b.season}, {plural(b.episodes, "episode")}</> : "No whole season finished in this period"} />
        <ShowRecord label="One show, one day" poster={e?.avatar_url} to={e && `/channel/${e.key}`}
                    value={e ? plural(e.episodes, "episode") : "–"}
                    detail={e ? <><b className="text-white">{e.title}</b> on {date(e.date)}</> : "Nothing in this period"} />
      </div>

      <QueryState q={rec} minHeight={220}>
        {(r) => (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] bg-white/[0.06] lg:grid-cols-3">
            <Tile label="Biggest day" value={r.biggest_day.by_count ? plural(r.biggest_day.by_count.count, "title") : "–"}
                  detail={r.biggest_day.by_count && date(r.biggest_day.by_count.date)} accent />
            <Tile label="Most watch time in a day" info value={r.biggest_day.by_time ? duration(r.biggest_day.by_time.time_s) : "–"}
                  detail={r.biggest_day.by_time && `${date(r.biggest_day.by_time.date)} · ${plural(r.biggest_day.by_time.count, "title")}`} />
            <Tile label="Longest streak" value={r.streaks.longest ? plural(r.streaks.longest.days, "day") : "–"}
                  detail={r.streaks.longest && `${date(r.streaks.longest.start!)} – ${date(r.streaks.longest.end!)}`} accent />
            <Tile label="Current streak" value={plural(r.streaks.current.days, "day")}
                  detail={r.streaks.current.days ? `since ${date(r.streaks.current.start!)}` : "No streak going right now"} />
            <Tile label="Longest break" value={r.streaks.longest_break ? plural(r.streaks.longest_break.days, "day") : "None"}
                  detail={r.streaks.longest_break && `${date(r.streaks.longest_break.start!)} – ${date(r.streaks.longest_break.end!)}`} />
            {hasTimes && r.longest_session
              ? <Tile label="Longest binge" info value={duration(r.longest_session.time_s)}
                      detail={`${plural(r.longest_session.videos, "title")} without a 30-min break · ${date(r.longest_session.start)}`} />
              : hasTimes && r.latest_night
                ? <Tile label="Latest night" value={clockTime(r.latest_night.local_iso)} detail={`${date(r.latest_night.local_iso)} · ${r.latest_night.channel ?? r.latest_night.title}`} />
                : <Tile label="Days you watched" value={ov.data ? num(ov.data.active_days) : "–"}
                        detail={ov.data && `of ${num(ov.data.days)} · ${pct(ov.data.pct_days_active)}`} />}
          </div>
        )}
      </QueryState>

      <Section title="Milestones" subtitle="Your 1st, 100th, 1,000th title… (all time)">
        <QueryState q={ms} minHeight={240} empty={(d) => !d.length}>
          {(d) => <MilestoneRow items={d} />}
        </QueryState>
      </Section>
    </div>
  );
}

function ShowRecord({ label, value, detail, poster, to }: { label: string; value: string; detail: ReactNode; poster?: string | null; to?: string }) {
  const q = useLinkQuery();
  const body = (
    <div className="flex h-full items-center gap-5 rounded-[4px] bg-[#181818] p-5 transition-colors hover:bg-[#202020]">
      <div className="w-[76px] shrink-0"><Poster src={poster} /></div>
      <div className="min-w-0">
        <div className="text-[12px] font-bold uppercase tracking-[0.15em] text-[#808080]">{label}</div>
        <div className="mt-2 text-[clamp(32px,3.4vw,48px)] font-black leading-none tracking-tight" style={{ color: RED }}>{value}</div>
        <div className="mt-2 text-[14px] text-[#b3b3b3]">{detail}</div>
      </div>
    </div>
  );
  return to ? <Link to={to + q} className="block">{body}</Link> : body;
}

function Tile({ label, value, detail, info = false, accent = false }: {
  label: string; value: string; detail?: ReactNode; info?: boolean; accent?: boolean;
}) {
  return (
    <div className="bg-[#181818] px-5 py-5">
      <div className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-[0.15em] text-[#808080]">{label}{info && <WatchTimeInfo />}</div>
      <div className="mt-2 text-[clamp(26px,2.6vw,38px)] font-black leading-none tracking-tight" style={accent ? { color: RED } : undefined}>{value}</div>
      {detail && <div className="mt-2 text-[13px] text-[#b3b3b3]">{detail}</div>}
    </div>
  );
}

function MilestoneRow({ items }: { items: Milestone[] }) {
  const q = useLinkQuery();
  return (
    <div className="no-scrollbar -mx-[4%] flex gap-4 overflow-x-auto px-[4%] pb-1">
      {items.map((m) => (
        <Link key={m.n} to={m.video_id ? `/video/${m.video_id}${q}` : "#"} className="group w-[220px] shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-black leading-none tracking-tight" style={{ color: RED }}>#{num(m.n)}</span>
            <span className="text-[12px] text-[#808080]">{date(m.local_iso)}</span>
          </div>
          <div className="mt-2 flex aspect-video items-center justify-center overflow-hidden rounded-[4px] bg-[#2f2f2f] text-[#808080]">
            {m.thumb ? <img src={m.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]" />
                     : <Film size={26} />}
          </div>
          <div className="mt-2 truncate text-[14px] font-bold">{m.title ?? "Untitled"}</div>
          <div className="truncate text-[12px] text-[#b3b3b3]">{m.channel ?? "Movie"}</div>
        </Link>
      ))}
    </div>
  );
}
