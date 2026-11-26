/* Shared parts of the game pages. Game platforms say how long you've played each game in total, never when, so
   nothing here invents dated hours: the past is told by achievement unlocks (real, timestamped moments of play),
   hours by day only from days the app tracked, and lifetime hours only as totals. */
import { ReactNode } from "react";
import { Link, awards } from "../platform";
import { useMeta } from "../api";
import { useLinkQuery } from "../filters";
import { date, num } from "../format";
import { OV, Poster, ScrollRow, Skeleton, kicker } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { DAYS, hourLabel, hoursShort, spanLabel } from "./takeaways";

export interface GameCard { key: string; title: string | null; poster: string | null; header?: string | null; minutes?: number;
  acquired?: string | null; last_played?: string | null }
export interface Unlock { game: GameCard; api: string; name: string; description: string | null; unlocked: string; rarity: number | null }
export interface Activity {
  range: { start: string; end: string };
  unlocks: number; active_days: number; games: number;
  top_games: { game: GameCard; unlocks: number; rank: number }[];
  days: { date: string; count: number }[]; hours: number[]; weekdays: number[];
  tracked: { est_s: number; days: number };
}
export interface TimelineRow { game: GameCard; minutes: number; genres: string[]; first_unlock: string | null; last_unlock: string | null; unlocks: number;
  achievements: number; acquired: string | null; last_played: string | null; first_played?: string | null; plays?: number | null }
export interface YearRow { year: number; unlocks: number; active_days: number; games: number;
  top: { game: GameCard; unlocks: number } | null; tracked_s: number; tracked_days: number }
export interface GameRecords {
  unlocks: number; rarest: Unlock[];
  best_day: { date: string; game: GameCard; count: number } | null;
  latest_night: Unlock | null; earliest_morning: Unlock | null;
  fastest_perfect: { key: string; days: number; achievements: number; completed: string; game: GameCard } | null;
  streak: { days: number; start: string; end: string } | null;
  tracked_best_day: { date: string; game: GameCard; est_s: number } | null;
  platinums?: { count: number; latest: Unlock } | null;
  sessions?: number | null;
  most_sessions?: { game: GameCard; plays: number } | null;
  longest_sessions?: { game: GameCard; minutes: number; plays: number } | null;
}

export const gameLink = (k: string) => `/channel/${encodeURIComponent(k)}`;
export const rarityLine = (r: number | null) =>
  (r == null ? "" : r < 1 ? "under 1% of players have it" : `${r < 10 ? r.toFixed(1) : Math.round(r)}% of players have it`);
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// ------------------------------------------------------------------ the year row

/** Each year's most active game (most achievements unlocked), as big covers like the top 10 row. Years with only
 *  tracked play show that instead. Click a year for its Wrapped. */
export function YearsRow({ rows }: { rows: YearRow[] }) {
  const thisYear = Number(useMeta().data?.today.slice(0, 4));
  const shown = rows.filter((y) => y.top || y.tracked_s);
  if (!shown.length) return <p style={{ color: OV.soft }}>No {awards().many} or tracked play yet.</p>;
  return (
    <>
      <ScrollRow outer="-mx-4 sm:mx-0" className="snap-x px-4 sm:px-0 lg:overflow-visible">
        <ol className="flex gap-4 pb-2 pt-2 lg:grid" style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, 10)},minmax(0,1fr))` }}>
          {shown.map((y) => (
            <li key={y.year} className="w-[130px] shrink-0 snap-start lg:w-auto lg:min-w-0">
              <Link to={`/wrapped?year=${y.year}`} className="group flex flex-col items-start gap-2"
                    aria-label={`${y.year}: ${y.top ? `most active in ${y.top.game.title}` : "tracked play"}. Open ${y.year} Wrapped`}>
                <span className="relative w-full">
                  <Poster src={y.top?.game.poster} name={y.top?.game.title ?? String(y.year)} width="100%"
                          className="transition-transform duration-150 group-hover:-translate-y-0.5" />
                  <span className="absolute -left-2 -top-2 rounded-full border-[3px] px-2.5 py-1 font-ov-display text-[14px] font-extrabold leading-none"
                        style={{ background: OV.paper, borderColor: OV.ink }}>{y.year}{y.year === thisYear ? " so far" : ""}</span>
                </span>
                <span className="w-full truncate text-[15px] font-bold group-hover:underline">{y.top?.game.title ?? "Tracked play"}</span>
                <span className="font-ov-display text-[17px] font-extrabold leading-tight">
                  {y.top ? plural(y.top.unlocks, awards().one, awards().many) : hoursShort(y.tracked_s)}
                </span>
                <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>
                  {plural(y.games, "game")}{y.tracked_s && y.top ? ` · ${hoursShort(y.tracked_s)} tracked` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </ScrollRow>
    </>
  );
}

// ------------------------------------------------------------------ the timeline

/** When you were into each game: a bar from its first to its last achievement on a shared year axis, with what's
 *  known for games without any (when you got it, when you last played) as marks, never as invented bars. */
export function GameTimeline({ rows, limit = 12 }: { rows: TimelineRow[]; limit?: number }) {
  const q = useLinkQuery();
  const today = useMeta().data?.today;
  const shown = [...rows].sort((a, b) => b.minutes - a.minutes || b.unlocks - a.unlocks).slice(0, limit);
  const dates = shown.flatMap((r) => [r.first_unlock, r.last_unlock, r.acquired, r.last_played, r.first_played]).filter(Boolean) as string[];
  if (!dates.length || !today) return <p style={{ color: OV.soft }}>No dated activity yet.</p>;
  const y0 = Number(dates.reduce((a, b) => (a < b ? a : b)).slice(0, 4));
  const y1 = Number(today.slice(0, 4));
  const t = (d: string) => (new Date(d + "T00:00:00").getTime() - new Date(`${y0}-01-01T00:00:00`).getTime())
                          / (new Date(`${y1 + 1}-01-01T00:00:00`).getTime() - new Date(`${y0}-01-01T00:00:00`).getTime()) * 100;
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col">
        {shown.map((r) => (
          <li key={r.game.key}>
            <Link to={gameLink(r.game.key) + q} className="group grid grid-cols-[1fr] items-center gap-x-4 gap-y-1 border-b py-2 sm:grid-cols-[220px_1fr_72px]"
                  style={{ borderColor: "#E0D5C1" }}>
              <span className="flex min-w-0 items-center gap-2.5">
                <Poster src={r.game.poster} name={r.game.title} width="30px" className="!rounded-md !border-2" />
                <span className="truncate text-[14px] font-bold group-hover:underline">{r.game.title}</span>
                <span className="ml-auto font-ov-display text-[14px] font-extrabold sm:hidden">{hoursShort(r.minutes * 60)}</span>
              </span>
              <span className="relative h-6" aria-label={timelineLabel(r)}>
                <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: "#E0D5C1" }} />
                {r.first_played && r.last_played && (
                  <span className="absolute top-1/2 h-4 -translate-y-1/2 rounded-full"
                        style={{ left: `${t(r.first_played)}%`, width: `max(10px, ${t(r.last_played) - t(r.first_played)}%)`, background: "#D9CDB6" }} />
                )}
                {r.first_unlock && r.last_unlock && (
                  <span className={`absolute top-1/2 -translate-y-1/2 rounded-full ${r.first_played ? "h-1.5" : "h-3"}`}
                        style={{ left: `${t(r.first_unlock)}%`, width: `max(${r.first_played ? 6 : 10}px, ${t(r.last_unlock) - t(r.first_unlock)}%)`, background: OV.ink }} />
                )}
                {r.acquired && <Mark at={t(r.acquired)} shape="diamond" />}
                {r.last_played && !r.last_unlock && !r.first_played && <Mark at={t(r.last_played)} shape="dot" />}
                {!r.first_unlock && !r.acquired && !r.last_played && !r.first_played && (
                  <span className="absolute inset-y-0 left-0 flex items-center font-shelf-mono text-[11px]" style={{ color: OV.soft }}>no dated activity</span>
                )}
              </span>
              <span className="hidden text-right font-ov-display text-[15px] font-extrabold sm:block">{hoursShort(r.minutes * 60)}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-[1fr] gap-x-4 sm:grid-cols-[220px_1fr_72px]">
        <span className="hidden sm:block" />
        <span className="relative h-5 font-shelf-mono text-[11px]" style={{ color: OV.soft }}>
          {years.filter((y) => years.length <= 8 || (y - y0) % 2 === 0).map((y) => (
            <span key={y} className="absolute -translate-x-1/2" style={{ left: `${t(`${y}-01-01`)}%` }}>{y}</span>
          ))}
        </span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
        {rows.some((r) => r.first_played) && <span><span className="mr-1.5 inline-block h-2.5 w-5 rounded-full align-middle" style={{ background: "#D9CDB6" }} />first to last played</span>}
        <span><span className="mr-1.5 inline-block h-2.5 w-5 rounded-full align-middle" style={{ background: OV.ink }} />first to last {awards().one}</span>
        {rows.some((r) => r.acquired) && <span><Mark inline shape="diamond" />when you got it</span>}
        {rows.some((r) => r.last_played && !r.last_unlock && !r.first_played) && <span><Mark inline shape="dot" />last played</span>}
      </p>
    </div>
  );
}

function timelineLabel(r: TimelineRow): string {
  const parts = [];
  if (r.first_played && r.last_played) parts.push(`played from ${date(r.first_played)} to ${date(r.last_played)}`);
  if (r.first_unlock && r.last_unlock) parts.push(`${awards().many} from ${date(r.first_unlock)} to ${date(r.last_unlock)}`);
  if (r.acquired) parts.push(`got it ${date(r.acquired)}`);
  if (r.last_played && !r.last_unlock) parts.push(`last played ${date(r.last_played)}`);
  return `${r.game.title}: ${parts.join(", ") || "no dated activity"}, ${hoursShort(r.minutes * 60)} in all`;
}

function Mark({ at, shape, inline = false }: { at?: number; shape: "diamond" | "dot"; inline?: boolean }) {
  const cls = shape === "diamond" ? "h-2.5 w-2.5 rotate-45 border-2" : "h-2.5 w-2.5 rounded-full border-2";
  const style = { borderColor: OV.ink, background: shape === "diamond" ? OV.mustard : OV.paper };
  return inline ? <span className={`mr-1.5 inline-block align-middle ${cls}`} style={style} />
                : <span className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${cls}`} style={{ ...style, left: `${at}%` }} />;
}

// ------------------------------------------------------------------ when you unlock

/** Achievements by hour of the day: real times (each unlock is timestamped). */
export function UnlockClock({ hours, height = 140, dark = false }: { hours: number[]; height?: number; dark?: boolean }) {
  const peak = hours.reduce((b, v, h) => (v > hours[b] ? h : b), 0);
  return (
    <HoverBars dark={dark} height={height} hint={`${hourLabel(peak)} is your busiest hour. Hover one to see it.`}
               ariaLabel={`${awards().Many} by hour of the day. Busiest: ${hourLabel(peak)}.`}
               bars={hours.map((v, h) => ({ key: String(h), label: `${hourLabel(h)} to ${hourLabel((h + 1) % 24)}`, value: v,
                                            display: plural(v, awards().one, awards().many), color: h === peak ? (dark ? OV.mustard : OV.teal) : dark ? "#5E554A" : "#CDBFA6" }))}
               ticks={<Ticks dark={dark} labels={["12 AM", "6 AM", "12 PM", "6 PM"]} />} />
  );
}

export function busiestWeekday(weekdays: number[]): string | null {
  const max = Math.max(...weekdays);
  return max ? WEEKDAYS[weekdays.indexOf(max)].slice(0, -1) : null;
}

export function UnlockWeekdays({ weekdays }: { weekdays: number[] }) {
  const max = Math.max(1, ...weekdays);
  return (
    <HoverBars height={120} gap={8} radius={6} hint="Hover a day to see it." ariaLabel={`${awards().Many} by day of the week. Busiest: ${busiestWeekday(weekdays) ?? "none"}.`}
               bars={weekdays.map((v, i) => ({ key: DAYS[i], label: WEEKDAYS[i], value: v, display: plural(v, awards().one, awards().many), color: v === max ? OV.teal : "#D9CDB6" }))}
               ticks={<Ticks labels={DAYS} />} />
  );
}

/** "Mostly at night" style headline from the unlock hours. */
export function timeOfDayTitle(hours: number[]): string {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return "When you play";
  const parts: [string, number][] = [["late at night", sum(hours, 0, 5)], ["in the morning", sum(hours, 5, 12)],
    ["in the afternoon", sum(hours, 12, 17)], ["in the evening", sum(hours, 17, 24)]];
  const [name, n] = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return `Mostly ${name}: ${Math.round((n / total) * 100)}% of your ${awards().many}.`;
}
const sum = (xs: number[], a: number, b: number) => xs.slice(a, b).reduce((s, v) => s + v, 0);

// ------------------------------------------------------------------ records

export function RecordCard({ label, big, line, bg, fg = OV.ink, pic, to, loading }: {
  label: string; big: string; line: ReactNode; bg: string; fg?: string; pic?: ReactNode; to?: string; loading?: boolean;
}) {
  const body = (
    <>
      <span className={kicker}>{label}</span>
      {loading ? <Skeleton h={72} /> : (
        <span className="flex items-center gap-4">
          {pic}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-ov-display text-[clamp(22px,2.2vw,30px)] font-extrabold leading-tight">{big}</span>
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

/** The real records as cards, most striking first; only the ones that exist. */
export function recordCards(r: GameRecords, q: string): ReactNode[] {
  const pic = (g: GameCard) => <Poster src={g.poster} name={g.title} width="52px" />;
  const out: ReactNode[] = [];
  const rare = r.rarest[0];
  if (rare) out.push(<RecordCard key="rare" label={`Rarest ${awards().one}`} bg={OV.mustard} to={gameLink(rare.game.key) + q} pic={pic(rare.game)}
                                 big={rare.name} line={<>{rarityLine(rare.rarity)} · {rare.game.title}, {date(rare.unlocked)}</>} />);
  if (r.latest_night) out.push(<RecordCard key="night" label="Latest night" bg={OV.ink} fg={OV.paper} to={gameLink(r.latest_night.game.key) + q}
                                           pic={pic(r.latest_night.game)} big={clock(r.latest_night.unlocked)}
                                           line={<>{r.latest_night.name} in {r.latest_night.game.title}, {date(r.latest_night.unlocked)}</>} />);
  if (r.best_day) out.push(<RecordCard key="day" label={`Most ${awards().many} in a day`} bg={OV.paper} to={gameLink(r.best_day.game.key) + q}
                                       pic={pic(r.best_day.game)} big={plural(r.best_day.count, awards().one, awards().many)}
                                       line={<>in {r.best_day.game.title}, {date(r.best_day.date)}</>} />);
  if (r.fastest_perfect) out.push(<RecordCard key="perfect" label="Fastest 100%" bg={OV.teal} fg={OV.paper} to={gameLink(r.fastest_perfect.key) + q}
                                              pic={pic(r.fastest_perfect.game)} big={plural(r.fastest_perfect.days, "day")}
                                              line={<>all {num(r.fastest_perfect.achievements)} in {r.fastest_perfect.game.title}, done {date(r.fastest_perfect.completed)}</>} />);
  if (r.streak && r.streak.days > 1) out.push(<RecordCard key="streak" label="Longest unlock streak" bg={OV.paper}
                                                          big={`${num(r.streak.days)} days in a row`} line={`${spanLabel(r.streak.start, r.streak.end)}, one every day`} />);
  if (r.earliest_morning) out.push(<RecordCard key="morning" label="Earliest morning" bg={OV.paper} to={gameLink(r.earliest_morning.game.key) + q}
                                               pic={pic(r.earliest_morning.game)} big={clock(r.earliest_morning.unlocked)}
                                               line={<>{r.earliest_morning.name} in {r.earliest_morning.game.title}, {date(r.earliest_morning.unlocked)}</>} />);
  if (r.platinums) out.push(<RecordCard key="plat" label="Platinums" bg={OV.teal} fg={OV.paper} to={gameLink(r.platinums.latest.game.key) + q}
                                         pic={pic(r.platinums.latest.game)} big={plural(r.platinums.count, "platinum")}
                                         line={<>latest: {r.platinums.latest.game.title}, {date(r.platinums.latest.unlocked)}</>} />);
  if (r.most_sessions) out.push(<RecordCard key="sessions" label="Most sessions" bg={OV.paper} to={gameLink(r.most_sessions.game.key) + q}
                                            pic={pic(r.most_sessions.game)} big={plural(r.most_sessions.plays, "session")}
                                            line={<>of {r.most_sessions.game.title}{r.sessions ? <>, of {num(r.sessions)} in all</> : null}</>} />);
  if (r.longest_sessions) out.push(<RecordCard key="long" label="Longest sessions" bg={OV.paper} to={gameLink(r.longest_sessions.game.key) + q}
                                               pic={pic(r.longest_sessions.game)} big={`${hoursShort(r.longest_sessions.minutes * 60)} on average`}
                                               line={<>in {r.longest_sessions.game.title}, over {plural(r.longest_sessions.plays, "session")}</>} />);
  if (r.tracked_best_day) out.push(<RecordCard key="tracked" label="Biggest tracked day" bg={OV.paper} to={gameLink(r.tracked_best_day.game.key) + q}
                                               pic={pic(r.tracked_best_day.game)} big={hoursShort(r.tracked_best_day.est_s)}
                                               line={<>of {r.tracked_best_day.game.title}, {date(r.tracked_best_day.date)}</>} />);
  return out;
}
