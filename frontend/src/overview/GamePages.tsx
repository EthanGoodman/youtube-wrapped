/* The game platforms' pages besides the Overview: All games (every game, its lifetime hours and achievements,
   sortable, filtered by genre), Achievements (rarest, per month, 100% games, recent) and a game's own page (lifetime
   hours, the checklist, and when you played it, told by its achievements: the platform keeps lifetime hours per
   game but not when they were played). */
import { ReactNode, useState } from "react";
import { useParams } from "react-router-dom";
import { Link, awards } from "../platform";
import { MonthPoint, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num, pct, safeHref } from "../format";
import { OV, PageBody, PageHeader, Poster, Seg, Skeleton, StatsFrame, kicker } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { Achievements, UnlockRow, rarityLine } from "./GamesOverviewPage";
import { TimelineRow, plural } from "./gamesKit";
import { hoursShort, periodTitle } from "./takeaways";

function Card({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border-2 p-5 sm:p-6" style={{ background: OV.paper, borderColor: OV.ink }}>
      <div className="flex flex-col gap-1">
        <span className={kicker} style={{ color: OV.soft }}>{label}</span>
        {title && <h2 className="font-ov-display text-[24px] font-extrabold leading-tight">{title}</h2>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ all games

type Sort = "hours" | "achievements" | "sessions" | "recent" | "name";

/** Every game you've played: lifetime hours (exact), achievements done of total, and the dates that are known. */
export function AllGamesPage() {
  const q = useLinkQuery();
  const t = useStats<TimelineRow[]>("games/timeline");
  const [sort, setSort] = useState<Sort>("hours");
  const [genre, setGenre] = useState<string | null>(null);
  const rows = t.data ?? [];
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const genres = [...new Set(rows.flatMap((r) => r.genres))].sort((a, b) =>
    rows.filter((r) => r.genres.includes(b)).length - rows.filter((r) => r.genres.includes(a)).length || a.localeCompare(b));
  const latest = (r: TimelineRow) => [r.last_unlock, r.last_played].filter(Boolean).sort().pop() ?? "";
  const hasPlays = rows.some((r) => r.plays);
  const shown = rows.filter((r) => !genre || r.genres.includes(genre)).sort((a, b) =>
    sort === "hours" ? b.minutes - a.minutes
    : sort === "achievements" ? done(b) - done(a) || b.unlocks - a.unlocks
    : sort === "sessions" ? (b.plays ?? 0) - (a.plays ?? 0) || b.minutes - a.minutes
    : sort === "recent" ? latest(b).localeCompare(latest(a)) || b.minutes - a.minutes
    : (a.game.title ?? "").localeCompare(b.game.title ?? ""));
  const genreHours = genre ? shown.reduce((s, r) => s + r.minutes, 0) : 0;
  return (
    <StatsFrame>
      <PageHeader label={`All games · lifetime`} title={t.data ? `${plural(rows.length, "game")}, ${hoursShort(total * 60)}.` : "All your games"}>
      </PageHeader>
      <PageBody>
        {!t.data ? <Skeleton h={500} /> : (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Seg label="Sort by" value={sort} onChange={setSort}
                   options={[["hours", "Hours"], ["achievements", awards().Many], ...(hasPlays ? [["sessions", "Sessions"] as [Sort, string]] : []), ["recent", "Most recent"], ["name", "Name"]]} />
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Genre">
                {[null, ...genres].map((g) => (
                  <button key={g ?? "all"} type="button" onClick={() => setGenre(g)} aria-pressed={genre === g}
                          className="min-h-9 rounded-full border-2 px-3 text-[13px] font-bold"
                          style={{ borderColor: OV.ink, background: genre === g ? OV.ink : "transparent", color: genre === g ? OV.paper : OV.ink }}>
                    {g ?? "All genres"}
                  </button>
                ))}
              </div>
            )}
            {genre && <p className="font-shelf-mono text-[13px]" style={{ color: OV.soft }}>{plural(shown.length, "game")} · {hoursShort(genreHours * 60)} · {Math.round((genreHours / Math.max(1, total)) * 100)}% of your hours</p>}
            <ol className="flex flex-col">
              {shown.map((r, i) => (
                <li key={r.game.key}>
                  <Link to={`/channel/${encodeURIComponent(r.game.key)}${q}`}
                        className="grid grid-cols-[28px_44px_1fr] items-center gap-x-3 gap-y-1 border-b py-3 hover:bg-black/[0.03] sm:grid-cols-[32px_48px_1fr_170px_90px]"
                        style={{ borderColor: "#E0D5C1" }}>
                    <span className="font-ov-display text-[15px] font-extrabold" style={{ color: OV.soft }}>{i + 1}</span>
                    <Poster src={r.game.poster} name={r.game.title} width="100%" className="!rounded-md !border-2" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[16px] font-bold">{r.game.title}</span>
                      <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{knownDates(r)}</span>
                      {r.plays ? <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{plural(r.plays, "session")} · {hoursShort((r.minutes * 60) / r.plays)} each on average</span> : null}
                      <span className="font-ov-display text-[15px] font-extrabold sm:hidden">{hoursShort(r.minutes * 60)}{r.achievements ? ` · ${r.unlocks}/${r.achievements}` : ""}</span>
                    </span>
                    <span className="hidden flex-col gap-1 sm:flex">
                      {r.achievements ? (
                        <>
                          <span className="font-shelf-mono text-[12px]">{num(r.unlocks)} of {num(r.achievements)} {awards().many}</span>
                          <span className="block h-2 overflow-hidden rounded-full" style={{ background: OV.sand }}>
                            <span className="block h-full rounded-full" style={{ width: `${done(r) * 100}%`, background: done(r) === 1 ? OV.teal : OV.ink }} />
                          </span>
                        </>
                      ) : <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>no {awards().many}</span>}
                    </span>
                    <span className="hidden text-right font-ov-display text-[18px] font-extrabold sm:block">{hoursShort(r.minutes * 60)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
      </PageBody>
    </StatsFrame>
  );
}

const done = (r: TimelineRow) => (r.achievements ? r.unlocks / r.achievements : 0);
function knownDates(r: TimelineRow): string {
  const parts = [];
  if (r.first_played && r.last_played) parts.push(`played ${date(r.first_played)} – ${date(r.last_played)}`);
  if (r.first_unlock && r.last_unlock && !r.first_played) parts.push(r.first_unlock === r.last_unlock ? `${awards().one} ${date(r.first_unlock)}` : `${awards().many} ${date(r.first_unlock)} – ${date(r.last_unlock)}`);
  if (r.last_played && !r.first_played) parts.push(`last played ${date(r.last_played)}`);
  if (r.acquired) parts.push(`got it ${date(r.acquired)}`);
  return parts.join(" · ") || "no dates known";
}

const monthLabel = (k: string, long = true) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", long ? { month: "long", year: "numeric" } : { month: "short" });

// ------------------------------------------------------------------ achievements

export function AchievementsPage() {
  const { filters } = useFilters();
  const meta = useMeta().data;
  const q = useLinkQuery();
  const a = useStats<Achievements>("games/achievements").data;
  const best = a?.per_month.length ? a.per_month.reduce((x, y) => (y.count > x.count ? y : x)) : null;
  const many = (a?.per_month.length ?? 0) > 24;
  return (
    <StatsFrame>
      <PageHeader label={`${awards().Many} · ${periodTitle(filters, meta?.today)}`} title={a ? `${num(a.unlocked)} ${awards().many} unlocked.` : awards().Many}>
        {a && <p className="text-[17px]" style={{ color: OV.mute }}>{num(a.total)} in your games in all.</p>}
      </PageHeader>
      <PageBody>
        {!a ? <Skeleton h={400} /> : !a.unlocked ? <p style={{ color: OV.soft }}>No achievements unlocked in this period.</p> : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="The rarest you unlocked" title={a.rarest[0] ? `${a.rarest[0].name}: ${rarityLine(a.rarest[0].rarity)}` : undefined}>
                <ol className="flex flex-col">{a.rarest.map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol>
              </Card>
              <Card label="Most recent"><ol className="flex flex-col">{a.recent.slice(0, 8).map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol></Card>
            </div>
            <Card label="Per month" title={best ? `${monthLabel(best.month)} was your biggest month` : undefined}>
              <HoverBars height={160} gap={2} radius={2} hint="Hover a month to see it." ariaLabel={`${awards().Many} per month`}
                         bars={a.per_month.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.count, display: `${num(m.count)} ${awards().many}`,
                                                         color: m.month === best?.month ? OV.accent : OV.ink }))}
                         ticks={<Ticks labels={a.per_month.map((m) => (m.month.endsWith("-01") ? m.month.slice(0, 4) : many ? "" : monthLabel(m.month, false)))} />} />
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="100% completed" title={a.perfect.length ? `${num(a.perfect.length)} game${a.perfect.length === 1 ? "" : "s"} with every ${awards().one}` : "None at 100% here"}>
                <ol className="flex flex-col">
                  {a.perfect.map((p) => (
                    <li key={p.game.key}>
                      <Link to={`/channel/${encodeURIComponent(p.game.key)}${q}`} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
                        <Poster src={p.game.poster} name={p.game.title} width="38px" className="!rounded-md !border-2" />
                        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.game.title}</span>
                        <span className="shrink-0 font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{num(p.achievements)} · {date(p.completed)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </Card>
              {a.best_day && (
                <Card label="Most in one day" title={`${num(a.best_day.count)} ${awards().many} in ${a.best_day.game.title ?? "one game"}`}>
                  <p className="text-[15px]">on {date(a.best_day.date)}.</p>
                </Card>
              )}
            </div>
          </>
        )}
      </PageBody>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ one game

interface Totals { videos: number; est_s: number; first_watched: string | null; last_watched: string | null; active_days: number }
interface ChannelDetail { channel: { title: string | null; avatar_url: string | null }; url: string | null; in_range: Totals; all_time: Totals }
interface Checklist { total: number; unlocked: number; pct: number | null;
                      achievements: { api: string; name: string; description: string | null; unlocked: string | null; rarity: number | null }[] }

export function GameDetailPage() {
  const { id = "" } = useParams();
  const g = useStats<ChannelDetail>(`channel/${encodeURIComponent(id)}`);
  const ch = useStats<Checklist>(`games/game/${encodeURIComponent(id)}`);
  const tl = useStats<TimelineRow[]>("games/timeline");
  const t = tl.data?.find((r) => r.game.key === id);
  const [show, setShow] = useState<"all" | "got" | "left">("all");
  const d = g.data;
  if (!d) return <StatsFrame>{g.error ? <p className="p-8">Game not found.</p> : <div className="p-8"><Skeleton h={400} /></div>}</StatsFrame>;
  const c = ch.data;
  const list = c?.achievements.filter((x) => show === "all" || (show === "got" ? x.unlocked : !x.unlocked)) ?? [];
  // when you played it: achievements unlocked per month (real dates), not hours (not known by month)
  const per: Record<string, number> = {};
  for (const x of c?.achievements ?? []) if (x.unlocked) per[x.unlocked.slice(0, 7)] = (per[x.unlocked.slice(0, 7)] ?? 0) + 1;
  const months = fill(Object.entries(per).sort().map(([month, count]) => ({ month, count, time_s: 0 })));
  const many = months.length > 24;
  const sessions = t?.plays ? [["Sessions", num(t.plays)], ["Average session", hoursShort((t.minutes * 60) / t.plays)]] as [string, string][] : [];
  const known = ([["First played", t?.first_played], ["Last played", t?.last_played], [`First ${awards().one}`, t?.first_unlock], [`Latest ${awards().one}`, t?.last_unlock], ["Got it", t?.acquired]] as [string, string | null | undefined][]).filter(([, v]) => v);
  const href = safeHref(d.url);
  return (
    <StatsFrame>
      <section style={{ background: OV.ink, color: OV.paper }}>
        <div className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 px-4 py-9 sm:flex-row sm:items-end sm:px-8">
          <Poster src={d.channel.avatar_url} name={d.channel.title} width="clamp(120px,13vw,180px)" ring={OV.paper} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className={kicker} style={{ color: OV.mustard }}>Game</span>
            <h1 className="font-ov-display text-[clamp(34px,4.6vw,60px)] font-extrabold leading-[1.02] tracking-[-0.02em]">{d.channel.title}</h1>
            <p className="text-[16px]" style={{ color: OV.mute }}>{hoursShort(d.all_time.est_s)} played in all{t?.unlocks ? `, ${plural(t.unlocks, awards().one, awards().many)}` : ""}.</p>
            {c && c.total > 0 && (
              <div className="flex max-w-[520px] flex-col gap-1.5">
                <span className="flex justify-between font-shelf-mono text-[13px]"><span>{num(c.unlocked)} of {num(c.total)} {awards().many}</span><span>{pct(c.pct ?? 0)}</span></span>
                <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: "#4A433B" }}>
                  <span className="block h-full rounded-full" style={{ width: `${(c.pct ?? 0) * 100}%`, background: c.pct === 1 ? OV.teal : OV.mustard }} />
                </span>
              </div>
            )}
          </div>
          {href && <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-10 shrink-0 items-center rounded-[10px] border-2 px-4 text-[15px] font-bold"
                      style={{ borderColor: OV.paper }}>Store page ↗</a>}
        </div>
      </section>
      <PageBody>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([["Hours, all time", hoursShort(d.all_time.est_s)], ...sessions, ...known.map(([l, v]) => [l, date(v)])] as [string, string][]).map(([l, v]) => (
            <div key={l} className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3" style={{ background: OV.paper, borderColor: OV.ink }}>
              <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: OV.soft }}>{l}</dt>
              <dd className="m-0 font-ov-display text-[24px] font-extrabold leading-tight">{v}</dd>
            </div>
          ))}
        </dl>
        {c && c.total > 0 && (
          <Card label={`${awards().Many} · yours first, then the rest (rarest first)`}>
            <Seg label="Show" value={show} onChange={setShow}
                 options={[["all", `All · ${num(c.total)}`], ["got", `Unlocked · ${num(c.unlocked)}`], ["left", `Still to get · ${num(c.total - c.unlocked)}`]]} />
            <ol className="flex flex-col">
              {list.map((x) => (
                <li key={x.api} className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: "#E0D5C1", opacity: x.unlocked ? 1 : 0.6 }}>
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold"
                        style={{ borderColor: OV.ink, background: x.unlocked ? OV.teal : "transparent", color: OV.paper }}>{x.unlocked ? "✓" : ""}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{x.name}</span>
                    {x.description && <span className="truncate text-[13px]" style={{ color: OV.soft }}>{x.description}</span>}
                  </span>
                  <span className="shrink-0 text-right font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
                    {x.unlocked ? date(x.unlocked) : "locked"}{x.rarity != null ? <><br />{x.rarity < 1 ? "<1" : Math.round(x.rarity)}% have it</> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}
        <Card label={`When you played it · ${awards().many} unlocked per month`}
              title={t?.first_unlock && t.last_unlock ? (t.first_unlock === t.last_unlock ? `All on ${date(t.first_unlock)}` : `${date(t.first_unlock)} to ${date(t.last_unlock)}`) : undefined}>
          {!months.length ? <p style={{ color: OV.soft }}>No {awards().many} in this game.</p> : (
            <HoverBars height={150} gap={2} radius={2} hint="Hover a month to see it." ariaLabel={`${awards().Many} unlocked per month`}
                       bars={months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.count, display: plural(m.count, awards().one, awards().many), color: OV.ink }))}
                       ticks={<Ticks labels={months.map((m) => (m.month.endsWith("-01") ? m.month.slice(0, 4) : many ? "" : monthLabel(m.month, false)))} />} />
          )}
        </Card>
      </PageBody>
    </StatsFrame>
  );
}

function fill(data: MonthPoint[]): MonthPoint[] {
  if (!data.length) return data;
  const got = new Map(data.map((m) => [m.month, m]));
  const out: MonthPoint[] = [];
  let [y, m] = data[0].month.split("-").map(Number);
  const [ey, em] = data[data.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(got.get(key) ?? { month: key, count: 0, time_s: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
