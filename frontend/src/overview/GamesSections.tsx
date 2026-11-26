/* Evolution, Patterns and Records for game platforms. Game platforms say how long you've played each game in total,
   never when, so these pages tell the past with achievement unlocks (real, timestamped moments of play), hours by
   day only from days the app tracked, and nothing else. No hours are spread onto invented days. */
import { ReactNode, useState } from "react";
import { useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { num } from "../format";
import { Link } from "../platform";
import { Band, OV, PageBody, PageHeader, Poster, ScrollRow, Skeleton, StatsFrame, kicker } from "./kit";
import { HeatLegend, HoverBars, Readout, Ticks } from "./charts";
import {
  Activity, GameRecords, GameTimeline, HoursNote, TimelineRow, UnlockClock, UnlockWeekdays, YearRow, YearsRow,
  busiestWeekday, gameLink, plural, recordCards, timeOfDayTitle,
} from "./gamesKit";
import { DAYS, calendarWeeks, heatColor, heatLevel, heatRange, hoursShort, periodTitle } from "./takeaways";

function Card({ label, title, children, className = "" }: { label: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-2xl border-2 p-5 ${className}`} style={{ background: OV.paper, borderColor: OV.ink }}>
      <span className={kicker} style={{ color: OV.soft }}>{label}</span>
      {title && <h3 className="font-ov-display text-[clamp(20px,2vw,26px)] font-extrabold leading-tight">{title}</h3>}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Evolution

export function GamesEvolutionPage() {
  const meta = useMeta().data;
  const years = useStats<YearRow[]>("games/years");
  const timeline = useStats<TimelineRow[]>("games/timeline");
  const rows = years.data;
  return (
    <StatsFrame>
      <PageHeader label="Evolution · all time" title={rows ? evolutionTitle(rows) : "How your games changed"}>
        <p className="max-w-[640px] text-[18px]" style={{ color: OV.mute }}>
          Told by your achievements: {meta?.platform.name ?? "the platform"} keeps lifetime hours per game, but not when you played them.
        </p>
      </PageHeader>
      <PageBody>
        <Band label="By achievements" title="Your most active game each year">
          {!rows ? <Skeleton h={260} /> : <YearsRow rows={rows} />}
        </Band>
        <PerYear rows={rows} />
        <Band label="From first to last achievement" title="When you were into each game">
          {!timeline.data ? <Skeleton h={400} /> : <GameTimeline rows={timeline.data} limit={60} />}
        </Band>
        <NewEachYear rows={timeline.data} />
      </PageBody>
    </StatsFrame>
  );
}

function evolutionTitle(rows: YearRow[]): string {
  // the longest run of consecutive years with the same most active game
  let best: { title: string; n: number } | null = null;
  let run = 0;
  rows.forEach((y, i) => {
    const prev = rows[i - 1];
    run = y.top && prev?.top && prev.year === y.year - 1 && prev.top.game.key === y.top.game.key ? run + 1 : 1;
    if (y.top && (!best || run > best.n)) best = { title: y.top.game.title ?? "One game", n: run };
  });
  const b = best as { title: string; n: number } | null;
  return b && b.n >= 2 ? `${b.title} led ${b.n} years running.` : "A different game almost every year.";
}

function PerYear({ rows }: { rows?: YearRow[] }) {
  const thisYear = Number(useMeta().data?.today.slice(0, 4));
  const shown = rows?.filter((y) => y.unlocks) ?? [];
  const best = shown.length ? shown.reduce((a, b) => (b.unlocks > a.unlocks ? b : a)) : null;
  const tracked = rows?.filter((y) => y.tracked_s) ?? [];
  return (
    <Band label="Achievements unlocked each year" title={best ? `${best.year} was your biggest year: ${plural(best.unlocks, "achievement")}.` : "Each year"}>
      {!rows ? <Skeleton h={220} /> : !shown.length ? <p style={{ color: OV.soft }}>No achievements unlocked yet.</p> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card label="Achievements per year">
            <HoverBars height={170} gap={10} radius={6} hint="Hover a year to see it." ariaLabel="Achievements unlocked each year"
                       bars={shown.map((y) => ({ key: String(y.year), label: `${y.year}${y.year === thisYear ? " so far" : ""}`, value: y.unlocks,
                                                 display: `${plural(y.unlocks, "achievement")} · ${plural(y.active_days, "day")} · ${plural(y.games, "game")}`,
                                                 color: y === best ? OV.mustard : OV.ink }))}
                       ticks={<Ticks labels={shown.map((y) => String(y.year))} />} />
          </Card>
          <Card label="Hours by year" title={tracked.length ? `${hoursShort(tracked.reduce((s, y) => s + y.tracked_s, 0))} tracked so far` : "Starting now"}>
            <p className="text-[15px]">Hours by year count from the day this app started checking your library: there's no record of when your
              earlier hours were played, so they're only in your lifetime total.</p>
            {tracked.map((y) => <p key={y.year} className="font-shelf-mono text-[13px]">{y.year}: {hoursShort(y.tracked_s)} over {plural(y.tracked_days, "day")}</p>)}
          </Card>
        </div>
      )}
    </Band>
  );
}

function NewEachYear({ rows }: { rows?: TimelineRow[] }) {
  const q = useLinkQuery();
  const by: Record<string, TimelineRow[]> = {};
  for (const r of rows ?? []) if (r.first_unlock) (by[r.first_unlock.slice(0, 4)] ??= []).push(r);
  const years = Object.keys(by).sort().reverse();
  return (
    <Band label="By each game's first achievement" title="New each year">
      {!rows ? <Skeleton h={200} /> : !years.length ? <p style={{ color: OV.soft }}>No achievements yet.</p> : (
        <div className="flex flex-col gap-5">
          {years.map((y) => (
            <div key={y} className="grid gap-3 sm:grid-cols-[80px_1fr]">
              <span className="font-ov-display text-[26px] font-extrabold">{y}</span>
              <ScrollRow outer="min-w-0" className="pb-1">
                <ol className="flex gap-3">
                  {by[y].map((r) => (
                    <li key={r.game.key} className="w-[88px] shrink-0">
                      <Link to={gameLink(r.game.key) + q} className="group flex flex-col gap-1">
                        <Poster src={r.game.poster} name={r.game.title} width="100%" className="!border-2" />
                        <span className="truncate text-[12px] font-bold group-hover:underline">{r.game.title}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </ScrollRow>
            </div>
          ))}
        </div>
      )}
    </Band>
  );
}

// ------------------------------------------------------------------ Patterns

export function GamesPatternsPage() {
  const meta = useMeta().data;
  const { filters } = useFilters();
  const a = useStats<Activity>("games/activity");
  const title = periodTitle(filters, meta?.today);
  const day = a.data ? busiestWeekday(a.data.weekdays) : null;
  return (
    <StatsFrame>
      <PageHeader label={`Patterns · ${title} · from the times you unlocked achievements`} title={a.data ? timeOfDayTitle(a.data.hours) : "When you play"}>
        {a.data && <p className="text-[18px]" style={{ color: OV.mute }}>
          {plural(a.data.unlocks, "achievement")} on {plural(a.data.active_days, "day")}, in {plural(a.data.games, "game")}.
        </p>}
      </PageHeader>
      <PageBody>
        {!a.data ? <Skeleton h={400} /> : !a.data.unlocks && !a.data.tracked.est_s ? (
          <p style={{ color: OV.soft }}>No achievements or tracked play in {title}. Try Lifetime in the period menu.</p>
        ) : (
          <>
            <UnlockCalendar days={a.data.days} start={a.data.range.start} end={a.data.range.end} />
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card label="By hour of the day" title="When you unlock achievements"><UnlockClock hours={a.data.hours} height={170} /></Card>
              <Card label="By day of the week" title={day ? `${day} is your busiest day` : "Each day"}><UnlockWeekdays weekdays={a.data.weekdays} /></Card>
            </div>
            <Card label="Hours by day" title={a.data.tracked.est_s ? `${hoursShort(a.data.tracked.est_s)} tracked over ${plural(a.data.tracked.days, "day")}` : "No tracked hours here yet"}>
              <HoursNote />
            </Card>
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}

interface CalDay { date: string; count: number }

/** One calendar row per year with unlocks (newest first): a square per day, darker for more achievements. */
function UnlockCalendar({ days, start, end }: { days: Activity["days"]; start: string; end: string }) {
  const [day, setDay] = useState<CalDay | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const count: Record<string, number> = Object.fromEntries(days.map((d) => [d.date, d.count]));
  const max = Math.max(1, ...days.map((d) => d.count));
  const years = [...new Set(days.map((d) => d.date.slice(0, 4)))].sort().reverse();
  const nice = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const info = day ? `${nice(day.date)} · ${day.count ? plural(day.count, "achievement") : "none"}`
    : level != null ? (level === 0 ? "Days without an achievement" : `Days with ${heatRange(level, max)[0]}–${heatRange(level, max)[1]} achievements`)
    : "Hover a day to see it, or a shade to light up those days.";
  return (
    <Card label="Every day" title={`Achievements on ${plural(days.length, "day")}`}>
      <Readout text={info} active={!!day || level != null} />
      <div className="flex flex-col gap-5" onMouseLeave={() => setDay(null)}>
        {years.map((y) => {
          const from = `${y}-01-01` < start ? start : `${y}-01-01`;
          const to = `${y}-12-31` > end ? end : `${y}-12-31`;
          const cells: CalDay[] = [];
          for (let t = new Date(from + "T00:00:00"); t <= new Date(to + "T00:00:00"); t.setDate(t.getDate() + 1)) {
            const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
            cells.push({ date: iso, count: count[iso] ?? 0 });
          }
          const weeks = calendarWeeks(cells);
          const n = cells.filter((c) => c.count).length;
          return (
            <div key={y} className="flex flex-col gap-1.5">
              <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}><strong className="font-ov-display text-[16px]" style={{ color: OV.ink }}>{y}</strong> · {plural(n, "day")}</span>
              <ScrollRow bg={OV.paper} className="pb-1">
                <div className="grid gap-[3px]" role="img" aria-label={`${y}: achievements on ${n} days`}
                     style={{ gridTemplateColumns: `24px repeat(${weeks.length},minmax(0,1fr))`, width: `min(100%, ${weeks.length * 22 + 28}px)`, minWidth: `${weeks.length * 11 + 28}px` }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((r) => [
                    <span key={`d${r}`} className="self-center font-shelf-mono text-[9px]" style={{ color: OV.soft }}>{r % 2 === 0 ? DAYS[r] : ""}</span>,
                    ...weeks.map((w, i) => {
                      const d = w[r];
                      if (!d) return <span key={`${i}-${r}`} />;
                      const lv = heatLevel(d.count, max);
                      return <span key={`${i}-${r}`} onMouseEnter={() => setDay(d)} className="aspect-square rounded-[2px]"
                                   style={{ background: heatColor(d.count, max), opacity: level != null && lv !== level ? 0.18 : 1,
                                            boxShadow: day?.date === d.date ? `0 0 0 2px ${OV.ink}` : undefined }} />;
                    }),
                  ])}
                </div>
              </ScrollRow>
            </div>
          );
        })}
      </div>
      <HeatLegend level={level} setLevel={setLevel} />
    </Card>
  );
}

// ------------------------------------------------------------------ Records

export function GamesRecordsPage() {
  const meta = useMeta().data;
  const { filters } = useFilters();
  const q = useLinkQuery();
  const r = useStats<GameRecords>("games/records");
  const cards = r.data ? recordCards(r.data, q) : null;
  return (
    <StatsFrame>
      <PageHeader label={`Records · ${periodTitle(filters, meta?.today)}`} title={cards?.length ? "Your personal bests." : "Your records"}>
        <p className="max-w-[640px] text-[18px]" style={{ color: OV.mute }}>
          Every one of these happened: they come from your achievements' real unlock times, and from days the app tracked your hours.
        </p>
      </PageHeader>
      <PageBody>
        {!cards ? <Skeleton h={400} /> : !cards.length ? <p style={{ color: OV.soft }}>No records in this period yet.</p> : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{cards}</div>
        )}
        {r.data && r.data.rarest.length > 1 && (
          <Band label="Rarest achievements" title="The ones few players have" link={["/achievements", "All your achievements"]}>
            <ol className="grid gap-4 md:grid-cols-3">
              {r.data.rarest.map((u, i) => (
                <li key={u.game.key + u.api}>
                  <Link to={gameLink(u.game.key) + q} className="flex items-center gap-3 rounded-2xl border-2 p-4 hover:-translate-y-0.5"
                        style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>
                    <Poster src={u.game.poster} name={u.game.title} width="48px" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-bold">{u.name}</span>
                      <span className="truncate font-shelf-mono text-[12px]">{u.game.title}</span>
                      <span className="font-ov-display text-[18px] font-extrabold">{u.rarity != null && u.rarity < 1 ? "<1" : num(Math.round(u.rarity ?? 0))}% of players</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Band>
        )}
      </PageBody>
    </StatsFrame>
  );
}
