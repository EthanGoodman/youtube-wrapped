/* Games pages beyond the shared ones: the Achievements page (rarest, per month, 100% games, recent) and a game's own
   page (hours, days played, the achievement checklist, when you played it). */
import { ReactNode, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "../platform";
import { HourPoint, MonthPoint, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num, pct, safeHref } from "../format";
import { OV, PageBody, PageHeader, Poster, Seg, Skeleton, StatsFrame, kicker } from "./kit";
import { HoverBars, Ticks } from "./charts";
import { Achievements, UnlockRow, rarityLine } from "./GamesOverviewPage";
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
      <PageHeader label={`Achievements · ${periodTitle(filters, meta?.today)}`} title={a ? `${num(a.unlocked)} achievements unlocked.` : "Achievements"}>
        <p className="text-[17px]" style={{ color: OV.mute }}>
          Every one is dated, so they show when you played, even before the app was tracking your hours.{a ? ` ${num(a.total)} in your games in all.` : ""}
        </p>
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
              <HoverBars height={160} gap={2} radius={2} hint="Hover a month to see it." ariaLabel="Achievements per month"
                         bars={a.per_month.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.count, display: `${num(m.count)} achievements`,
                                                         color: m.month === best?.month ? OV.accent : OV.ink }))}
                         ticks={<Ticks labels={a.per_month.map((m) => (m.month.endsWith("-01") ? m.month.slice(0, 4) : many ? "" : monthLabel(m.month, false)))} />} />
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card label="100% completed" title={a.perfect.length ? `${num(a.perfect.length)} game${a.perfect.length === 1 ? "" : "s"} with every achievement` : "None at 100% here"}>
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
                <Card label="Most in one day" title={`${num(a.best_day.count)} achievements in ${a.best_day.game.title ?? "one game"}`}>
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
interface ChannelDetail { channel: { title: string | null; avatar_url: string | null }; url: string | null; in_range: Totals; all_time: Totals; monthly: MonthPoint[]; clock: HourPoint[];
                          rank_history: { year: number; rank: number }[] }
interface Checklist { total: number; unlocked: number; pct: number | null;
                      achievements: { api: string; name: string; description: string | null; unlocked: string | null; rarity: number | null }[] }

export function GameDetailPage() {
  const { id = "" } = useParams();
  const g = useStats<ChannelDetail>(`channel/${encodeURIComponent(id)}`);
  const ch = useStats<Checklist>(`games/game/${encodeURIComponent(id)}`);
  const [show, setShow] = useState<"all" | "got" | "left">("all");
  const d = g.data;
  if (!d) return <StatsFrame>{g.error ? <p className="p-8">Game not found.</p> : <div className="p-8"><Skeleton h={400} /></div>}</StatsFrame>;
  const best = d.rank_history.reduce<{ year: number; rank: number } | null>((a, b) => (!a || b.rank < a.rank ? b : a), null);
  const c = ch.data;
  const list = c?.achievements.filter((x) => show === "all" || (show === "got" ? x.unlocked : !x.unlocked)) ?? [];
  const months = fill(d.monthly);
  const many = months.length > 24;
  const href = safeHref(d.url);
  return (
    <StatsFrame>
      <section style={{ background: OV.ink, color: OV.paper }}>
        <div className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 px-4 py-9 sm:flex-row sm:items-end sm:px-8">
          <Poster src={d.channel.avatar_url} name={d.channel.title} width="clamp(120px,13vw,180px)" ring={OV.paper} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className={kicker} style={{ color: OV.mustard }}>Game</span>
            <h1 className="font-ov-display text-[clamp(34px,4.6vw,60px)] font-extrabold leading-[1.02] tracking-[-0.02em]">{d.channel.title}</h1>
            <p className="text-[16px]" style={{ color: OV.mute }}>{best ? `At its best your #${num(best.rank)} game, in ${best.year}.` : ""}</p>
            {c && c.total > 0 && (
              <div className="flex max-w-[520px] flex-col gap-1.5">
                <span className="flex justify-between font-shelf-mono text-[13px]"><span>{num(c.unlocked)} of {num(c.total)} achievements</span><span>{pct(c.pct ?? 0)}</span></span>
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
          {([["Hours", hoursShort(d.all_time.est_s)], ["Days played", num(d.all_time.active_days)],
             ["First played", d.all_time.first_watched ? date(d.all_time.first_watched) : "–"], ["Last played", d.all_time.last_watched ? date(d.all_time.last_watched) : "–"]] as [string, string][]).map(([l, v]) => (
            <div key={l} className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3" style={{ background: OV.paper, borderColor: OV.ink }}>
              <dt className="font-shelf-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: OV.soft }}>{l}</dt>
              <dd className="m-0 font-ov-display text-[24px] font-extrabold leading-tight">{v}</dd>
            </div>
          ))}
        </dl>
        {c && c.total > 0 && (
          <Card label="Achievements · yours first, then the rest (rarest first)">
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
        <Card label="When you played it · all time, hours per month" title={d.all_time.first_watched ? `${date(d.all_time.first_watched)} to ${date(d.all_time.last_watched)}` : undefined}>
          {!months.length ? <p style={{ color: OV.soft }}>No dated play.</p> : (
            <HoverBars height={150} gap={2} radius={2} hint="Hover a month to see it." ariaLabel="Hours per month"
                       bars={months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.time_s, display: hoursShort(m.time_s), color: OV.ink }))}
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
