import { ReactNode } from "react";
import { Link, tr, useCapability } from "../platform";
import { CalendarDays, Clock3, Flame, Hourglass, Moon, Rocket, Sunrise, Tv, Zap } from "lucide-react";
import { WatchInfo, useStats } from "../api";
import { PageTitle, QueryState, Section, Thumb, WatchTimeInfo } from "../components/ui";
import { clockTime, date, duration, num } from "../format";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";

interface Streak { days: number; start: string | null; end: string | null }
interface RecordsResponse {
  biggest_day: { by_count: { date: string; count: number; time_s: number } | null; by_time: { date: string; count: number; time_s: number } | null };
  longest_session: { videos: number; time_s: number; span_s: number; start: string; top_channel: string | null } | null;
  streaks: { longest: Streak | null; current: Streak; longest_break: Streak | null };
  latest_night: WatchInfo | null;
  earliest_morning: WatchInfo | null;
  channel_day: { date: string; channel_id: string; channel: string; count: number } | null;
  oldest: (WatchInfo & { published_at: string }) | null;
  early_bird_count: number;
  fastest: (WatchInfo & { seconds_after_upload: number }) | null;
  counts: { ads: number; ad_impressions: number; ad_clicks: number; unavailable: number; surveys: number; posts: number };
}
type Milestone = WatchInfo & { n: number };

export function Records() {
  const hasTimes = useCapability("time_of_day");
  const { filters } = useFilters();
  const rec = useStats<RecordsResponse>("records");
  const ms = useStats<Milestone[]>("milestones");
  const q = useLinkQuery();

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Records" subtitle={`Your personal bests from ${rangeLabel(filters)}`} />
      <QueryState q={rec} minHeight={500}>
        {(r) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <RecordCard icon={<CalendarDays />} label="Biggest day" value={r.biggest_day.by_count ? tr(`${num(r.biggest_day.by_count.count)} videos`) : "–"}
                        detail={r.biggest_day.by_count && date(r.biggest_day.by_count.date)} />
            <RecordCard icon={<Clock3 />} label="Most watch time in a day" info
                        value={r.biggest_day.by_time ? duration(r.biggest_day.by_time.time_s) : "–"}
                        detail={r.biggest_day.by_time && tr(`${date(r.biggest_day.by_time.date)} · ${num(r.biggest_day.by_time.count)} videos`)} />
            <RecordCard icon={<Tv />} label="Longest binge" info
                        value={r.longest_session ? duration(r.longest_session.time_s) : "–"}
                        detail={r.longest_session && tr(`${num(r.longest_session.videos)} videos without a 30-min break · ${date(r.longest_session.start)}`) + (r.longest_session.top_channel ? ` · mostly ${r.longest_session.top_channel}` : "")} />
            <RecordCard icon={<Flame />} label="Longest streak" value={r.streaks.longest ? `${num(r.streaks.longest.days)} days` : "–"}
                        detail={r.streaks.longest && `${date(r.streaks.longest.start)} – ${date(r.streaks.longest.end)}`} />
            <RecordCard icon={<Zap />} label="Current streak" value={`${num(r.streaks.current.days)} days`}
                        detail={r.streaks.current.days ? `since ${date(r.streaks.current.start)}` : "No streak going right now"} />
            <RecordCard icon={<Hourglass />} label="Longest break" value={r.streaks.longest_break ? `${num(r.streaks.longest_break.days)} days` : "None"}
                        detail={r.streaks.longest_break && `${date(r.streaks.longest_break.start)} – ${date(r.streaks.longest_break.end)}`} />
            {r.channel_day && (
              <RecordCard icon={<Rocket />} label={tr("One channel, one day")} value={tr(`${num(r.channel_day.count)} videos`)}
                          detail={<><Link className="text-ink hover:underline" to={`/channel/${r.channel_day.channel_id}${q}`}>{r.channel_day.channel}</Link> on {date(r.channel_day.date)}</>} />
            )}
            <RecordCard icon={<Zap />} label="Early bird" value={tr(`${num(r.early_bird_count)} videos`)}
                        detail={r.fastest ? `watched within an hour of upload · fastest: ${duration(r.fastest.seconds_after_upload)} after` : "watched within an hour of upload"} />
            <RecordCard icon={<Tv />} label={tr("Removed & private videos")}
                        value={tr(`${num(r.counts.unavailable)} videos`)}
                        detail={`still counted as watches · ${num(r.counts.ads)} ads and ${num(r.counts.surveys)} surveys are left out of everything`} />
          </div>
        )}
      </QueryState>

      <QueryState q={rec} minHeight={200}>
        {(r) => (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {hasTimes && <WatchCard icon={<Moon size={18} />} title="Latest night" subtitle="Closest to 5am" w={r.latest_night} />}
            {hasTimes && <WatchCard icon={<Sunrise size={18} />} title="Earliest morning" subtitle="Earliest after 5am" w={r.earliest_morning} />}
            <WatchCard icon={<CalendarDays size={18} />} title={tr("Oldest video you watched")}
                       subtitle={r.oldest ? `Uploaded ${date(r.oldest.published_at)}` : ""} w={r.oldest} />
          </div>
        )}
      </QueryState>

      <Section title="Milestones" subtitle={tr("Your 1st, 1,000th, 10,000th video… (all time)")}>
        <QueryState q={ms} minHeight={200} empty={(d) => !d.length}>
          {(d) => (
            <ol className="relative ml-3 border-l border-line">
              {d.map((m) => (
                <li key={m.n} className="relative mb-1 pl-5">
                  <span className="absolute -left-[7px] top-5 h-3 w-3 rounded-full bg-yt ring-4 ring-card" />
                  <Link to={m.video_id ? `/video/${m.video_id}${q}` : "#"} className="link-row">
                    <div className="w-20 shrink-0">
                      <div className="text-base font-black">#{num(m.n)}</div>
                      <div className="text-xs text-sub">{date(m.local_iso)}</div>
                    </div>
                    <Thumb src={m.thumb} videoId={m.video_id} short={m.bucket === "short"} width={96} />
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-sm font-medium">{m.title ?? tr("Unavailable video")}</div>
                      <div className="truncate text-xs text-sub">{m.channel}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function RecordCard({ icon, label, value, detail, info }: {
  icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode; info?: boolean;
}) {
  return (
    <div className="card flex gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yt/15 text-yt-soft [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm text-sub">{label}{info && <WatchTimeInfo />}</div>
        <div className="text-2xl font-bold">{value}</div>
        {detail && <div className="mt-0.5 text-xs text-sub">{detail}</div>}
      </div>
    </div>
  );
}

function WatchCard({ icon, title, subtitle, w }: { icon: ReactNode; title: string; subtitle: string; w: WatchInfo | null }) {
  const q = useLinkQuery();
  return (
    <Section title={<span className="flex items-center gap-2">{icon}{title}</span>} subtitle={subtitle}>
      {w ? (
        <Link to={w.video_id ? `/video/${w.video_id}${q}` : "#"} className="group block">
          <div className="text-4xl font-black text-yt-soft">{clockTime(w.local_iso)}</div>
          <div className="mb-3 text-sm text-sub">{date(w.local_iso)}</div>
          <div className="flex gap-3">
            <Thumb src={w.thumb} videoId={w.video_id} short={w.bucket === "short"} width={120} />
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-medium group-hover:underline">{w.title ?? tr("Unavailable video")}</div>
              <div className="truncate text-xs text-sub">{w.channel}</div>
            </div>
          </div>
        </Link>
      ) : (
        <p className="text-sm text-muted">Nothing in this period.</p>
      )}
    </Section>
  );
}
