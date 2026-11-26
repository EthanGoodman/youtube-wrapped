/* The home page for game platforms (Steam, Epic), in the shared look. Only what's really known:
   - Lifetime: exact lifetime hours and your top 10 games by hours (the platform's own totals).
   - A period (a year, the past 6 months…): measured by achievements unlocked in it, plus hours the app tracked.
   - The past is told by achievement unlocks, real timestamped moments of play: when you were into each game, when
     in the day you play, each year's most active game, and real records. No hours are spread onto invented days. */
import { ReactNode } from "react";
import { Link, awards, useCapability } from "../platform";
import { Overview, RankedItem, TopResponse, useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { date, num } from "../format";
import { Band, MoveBadge, OV, Poster, ScrollRow, Skeleton, StatsFrame, kicker, useAccent, usePrevRanks } from "./kit";
import {
  Activity, GameCard, GameRecords, GameTimeline, TimelineRow, Unlock, UnlockClock, UnlockWeekdays, YearRow, YearsRow,
  busiestWeekday, gameLink, plural, rarityLine, recordCards, timeOfDayTitle,
} from "./gamesKit";
import { hoursShort, periodTitle, rankMove } from "./takeaways";

export { rarityLine };
export type { GameCard, Unlock };
export interface Achievements {
  unlocked: number; total: number; per_month: { month: string; count: number }[];
  best_day: { date: string; game: GameCard; count: number } | null;
  rarest: Unlock[]; recent: Unlock[]; perfect: { game: GameCard; achievements: number; completed: string }[];
}

export function GamesOverviewPage() {
  const meta = useMeta();
  const { filters } = useFilters();
  const lifetime = filters.range === "all";
  const byTime = { ...filters, metric: "time" as const };
  const ov = useStats<Overview>("overview", {}, { enabled: lifetime });
  const games = useStats<TopResponse>("top/channels", { limit: 10 }, { filters: byTime, enabled: lifetime });
  const act = useStats<Activity>("games/activity");
  const ach = useStats<Achievements>("games/achievements");
  const { prevRank } = usePrevRanks("channels", byTime);
  const title = periodTitle(filters, meta.data?.today);
  // a period with nothing dated in it: one line and the years, not a page of empty sections
  const quiet = !lifetime && !!act.data && !act.data.unlocks && !act.data.tracked.est_s;
  return (
    <StatsFrame>
      {lifetime ? <LifetimeHero o={ov.data} top={games.data?.items[0]} ach={ach.data} />
                : <PeriodHero title={title} act={act.data} />}
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        {!quiet && (lifetime ? <TopByHours items={games.data?.items} prevRank={prevRank} /> : <TopByUnlocks a={act.data} title={title} />)}
        {lifetime && <Timeline />}
        {!quiet && <AchievementsBand a={ach.data} />}
        {!quiet && <WhenYouPlay a={act.data} />}
        <Years />
        {!quiet && <Records />}
      </main>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ heroes

function Shell({ children, side }: { children: ReactNode; side?: ReactNode }) {
  const accent = useAccent();
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 35%, ${accent} 150%)` }} />
      <div className="relative mx-auto flex min-h-[clamp(400px,58vh,600px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[640px] flex-col gap-5">{children}</div>
        {side && <div className="shrink-0 lg:w-[300px]">{side}</div>}
      </div>
    </section>
  );
}

function BigNumber({ value, unit, sub }: { value: string; unit: string; sub: string }) {
  return (
    <h1 className="flex items-baseline gap-4 font-ov-display font-extrabold leading-[0.82]">
      <span className="text-[clamp(96px,13vw,190px)] tracking-[-0.05em]" style={{ color: OV.mustard }}>{value}</span>
      <span className="flex flex-col gap-1">
        <span className="text-[clamp(26px,2.6vw,38px)]">{unit}</span>
        <span className="font-shelf-mono text-[12px] font-normal" style={{ color: OV.mute }}>{sub}</span>
      </span>
    </h1>
  );
}

function LifetimeHero({ o, top, ach }: { o?: Overview; top?: RankedItem; ach?: Achievements }) {
  const q = useLinkQuery();
  const meta = useMeta().data;
  const first = meta?.first_date;              // the first real day of play (or of an unlock)
  return (
    <Shell side={top ? (
      <Link to={gameLink(top.key) + q} className="group flex items-center gap-5 lg:flex-col lg:items-start">
        <span className="relative">
          <Poster src={top.avatar_url} name={top.title} width="clamp(110px,12vw,180px)" ring={OV.paper} />
          <span className="absolute -right-4 -top-3 flex h-14 w-14 rotate-6 items-center justify-center rounded-full border-[3px] font-ov-display text-[20px] font-extrabold"
                style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }} aria-hidden>#1</span>
        </span>
        <span className="flex flex-col gap-1.5">
          <span className={kicker} style={{ color: OV.mustard }}>Your most-played game</span>
          <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">{top.title}</span>
          <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>
            {hoursShort(top.time_s)}{o?.est_s ? ` · ${Math.round((top.time_s / o.est_s) * 100)}% of all your hours` : ""}
          </span>
        </span>
      </Link>
    ) : undefined}>
      <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "games"} · lifetime</span>
      {o ? (
        <>
          <BigNumber value={num(Math.round(o.est_s / 3600))} unit="hours" sub="played, all time" />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat v={num(o.unique_channels)} l="games played" />
            <Stat v={ach ? num(ach.unlocked) : "–"} l={awards().many} />
            <Stat v={ach ? num(ach.perfect.length) : "–"} l="at 100%" />
            <Stat v={first ? first.slice(0, 4) : "–"} l="playing since" />
          </dl>
        </>
      ) : <Skeleton h={240} dark />}
    </Shell>
  );
}

function PeriodHero({ title, act }: { title: string; act?: Activity }) {
  const meta = useMeta().data;
  const { update } = useFilters();
  const top = act?.top_games[0];
  const q = useLinkQuery();
  return (
    <Shell side={top ? (
      <Link to={gameLink(top.game.key) + q} className="group flex items-center gap-5 lg:flex-col lg:items-start">
        <Poster src={top.game.poster} name={top.game.title} width="clamp(110px,12vw,180px)" ring={OV.paper} />
        <span className="flex flex-col gap-1.5">
          <span className={kicker} style={{ color: OV.mustard }}>Most active in</span>
          <span className="font-ov-display text-[clamp(24px,2.4vw,34px)] font-extrabold leading-tight group-hover:underline">{top.game.title}</span>
          <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{plural(top.unlocks, awards().one, awards().many)}</span>
        </span>
      </Link>
    ) : undefined}>
      <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "games"} · {title}</span>
      {act && !act.unlocks && !act.tracked.est_s ? (
        <>
          <h1 className="font-ov-display text-[clamp(40px,5.4vw,72px)] font-extrabold leading-[1.02] tracking-[-0.02em]">Nothing dated in {title}.</h1>
          <p className="max-w-[560px] text-[18px]">
            <button type="button" onClick={() => update({ range: "all" })} className="font-bold underline underline-offset-4" style={{ color: OV.mustard }}>
              See your lifetime
            </button>
          </p>
        </>
      ) : act ? (
        <>
          <BigNumber value={num(act.unlocks)} unit={act.unlocks === 1 ? awards().one : awards().many} sub="unlocked" />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <Stat v={num(act.active_days)} l={act.active_days === 1 ? "day with one" : "days with one"} />
            <Stat v={num(act.games)} l={act.games === 1 ? "game" : "games"} />
            <Stat v={act.tracked.est_s ? hoursShort(act.tracked.est_s) : "–"} l="hours tracked" />
          </dl>
        </>
      ) : <Skeleton h={240} dark />}
    </Shell>
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

// ------------------------------------------------------------------ top games

function CoverRow({ items }: { items: { key: string; rank: number; game: GameCard; big: string; extra?: ReactNode }[] }) {
  const q = useLinkQuery();
  return (
    <ScrollRow key={q} outer="-mx-4 sm:mx-0" className="snap-x px-4 sm:px-0 lg:overflow-visible">
      <ol className="flex gap-4 pb-2 pt-2 lg:grid lg:grid-cols-10">
        {items.map((c) => (
          <li key={c.key} className="w-[130px] shrink-0 snap-start lg:w-auto lg:min-w-0">
            <Link to={gameLink(c.key) + q} className="group flex flex-col items-start gap-2">
              <span className="relative w-full">
                <Poster src={c.game.poster} name={c.game.title} width="100%" className="transition-transform duration-150 group-hover:-translate-y-0.5" />
                <span className="absolute -left-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                      style={{ background: c.rank === 1 ? OV.mustard : OV.paper, borderColor: OV.ink }} aria-hidden>{c.rank}</span>
              </span>
              <span className="w-full truncate text-[15px] font-bold group-hover:underline">{c.game.title}</span>
              <span className="font-ov-display text-[17px] font-extrabold leading-tight">{c.big}</span>
              {c.extra}
            </Link>
          </li>
        ))}
      </ol>
    </ScrollRow>
  );
}

function TopByHours({ items, prevRank }: { items?: RankedItem[]; prevRank: (c: RankedItem) => number | null | undefined }) {
  return (
    <Band label="By lifetime hours" title="Your top 10 games" link={["/top/channels", "All your games"]}>
      {!items ? <Skeleton h={300} /> : !items.length ? <p style={{ color: OV.soft }}>No games played yet.</p> : (
        <CoverRow items={items.map((c) => ({ key: c.key, rank: c.rank, game: { key: c.key, title: c.title ?? null, poster: c.avatar_url ?? null },
                                             big: hoursShort(c.time_s), extra: <MoveBadge m={rankMove(c.rank, prevRank(c))} /> }))} />
      )}
    </Band>
  );
}

function TopByUnlocks({ a, title }: { a?: Activity; title: string }) {
  return (
    <Band label={`By ${awards().many} unlocked · ${title}`} title={`Where your ${awards().many} came from`} link={["/achievements", `All your ${awards().many}`]}>
      {!a ? <Skeleton h={300} /> : !a.top_games.length
        ? <p style={{ color: OV.soft }}>No {awards().many} unlocked in this period.</p>
        : <CoverRow items={a.top_games.map((t) => ({ key: t.game.key, rank: t.rank, game: t.game, big: plural(t.unlocks, awards().one, awards().many) }))} />}
    </Band>
  );
}

// ------------------------------------------------------------------ timeline, achievements, patterns, years, records

function Timeline() {
  const t = useStats<TimelineRow[]>("games/timeline");
  // the headline: your most-played game that has dated achievements, and how long you kept unlocking in it
  const dated = t.data?.filter((r) => r.first_unlock);
  const lead = dated?.length ? dated.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null;
  return (
    <Band label="Your games over the years"
          title={lead && span(lead) > 60 ? `${lead.game.title}: ${yearsBetween(lead)} of ${awards().many}.` : "When you were into each game"}>
      {!t.data ? <Skeleton h={320} /> : <GameTimeline rows={t.data} />}
    </Band>
  );
}
const span = (r: TimelineRow) => (r.first_unlock && r.last_unlock ? (Date.parse(r.last_unlock) - Date.parse(r.first_unlock)) / 864e5 : 0);
const yearsBetween = (r: TimelineRow) => {
  const y = Number(r.last_unlock!.slice(0, 4)) - Number(r.first_unlock!.slice(0, 4));
  return y >= 1 ? `${y + 1} years` : `${Math.round(span(r) / 30)} months`;
};

export function UnlockRow({ u }: { u: Unlock }) {
  const q = useLinkQuery();
  return (
    <li>
      <Link to={gameLink(u.game.key) + q} className="flex items-center gap-3 border-b py-2.5 hover:bg-black/[0.03]" style={{ borderColor: "#E0D5C1" }}>
        <Poster src={u.game.poster} name={u.game.title} width="38px" className="!rounded-md !border-2" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold">{u.name}</span>
          <span className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{u.game.title} · {date(u.unlocked)}</span>
        </span>
        {u.rarity != null && (
          <span className="shrink-0 rounded-full border-2 px-2.5 py-0.5 font-ov-display text-[13px] font-extrabold"
                style={{ borderColor: OV.ink, background: u.rarity < 10 ? OV.mustard : OV.paper }}>{u.rarity < 1 ? "<1" : Math.round(u.rarity)}%</span>
        )}
      </Link>
    </li>
  );
}

function AchievementsBand({ a }: { a?: Achievements }) {
  if (!useCapability("achievements")) return null;
  const rare = a?.rarest[0];
  return (
    <Band label={awards().Many} title={a ? (rare ? `${rare.name}: ${rarityLine(rare.rarity)}.` : `${num(a.unlocked)} ${awards().many}.`) : awards().Many}
          link={["/achievements", `All your ${awards().many}`]}>
      {!a ? <Skeleton h={240} /> : !a.unlocked ? <p style={{ color: OV.soft }}>No {awards().many} unlocked in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card label="Rarest you unlocked"><ol className="flex flex-col">{a.rarest.slice(0, 4).map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol></Card>
          <Card label="Most recent"><ol className="flex flex-col">{a.recent.slice(0, 4).map((u) => <UnlockRow key={u.game.key + u.api} u={u} />)}</ol></Card>
        </div>
      )}
    </Band>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 px-5 py-4" style={{ background: OV.paper, borderColor: OV.ink }}>
      <span className={kicker} style={{ color: OV.soft }}>{label}</span>
      {children}
    </section>
  );
}

function WhenYouPlay({ a }: { a?: Activity }) {
  const day = a ? busiestWeekday(a.weekdays) : null;
  return (
    <Band label="When you play" title={a ? timeOfDayTitle(a.hours) : "When you play"}>
      {!a ? <Skeleton h={240} /> : !a.unlocks ? <p style={{ color: OV.soft }}>No {awards().many} in this period.</p> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <figure className="flex flex-col gap-3 rounded-2xl p-5" style={{ background: OV.ink, color: OV.paper }}>
            <figcaption className="text-[15px]">{awards().Many} by hour of the day</figcaption>
            <UnlockClock hours={a.hours} dark height={150} />
          </figure>
          <figure className="flex flex-col gap-3 rounded-2xl border-2 p-5" style={{ background: OV.paper, borderColor: OV.ink }}>
            <figcaption><span className="font-ov-display text-[28px] font-extrabold">{day ?? "–"}</span><span className="ml-2 text-[15px]">is your busiest day</span></figcaption>
            <UnlockWeekdays weekdays={a.weekdays} />
          </figure>
        </div>
      )}
    </Band>
  );
}

function Years() {
  const y = useStats<YearRow[]>("games/years");
  const rows = y.data;
  const counted = rows?.filter((r) => r.top) ?? [];
  const best = counted.length ? counted.reduce((a, b) => (b.unlocks > a.unlocks ? b : a)) : null;
  return (
    <Band label={`Your most active game each year · by ${awards().many}`}
          title={best ? `${best.year} was your biggest year: ${plural(best.unlocks, awards().one, awards().many)}.` : "Each year"}>
      {!rows ? <Skeleton h={260} /> : <YearsRow rows={rows} />}
    </Band>
  );
}

function Records() {
  const q = useLinkQuery();
  const r = useStats<GameRecords>("games/records");
  const cards = r.data ? recordCards(r.data, q).slice(0, 3) : null;
  return (
    <Band label="Records" title={r.data?.rarest[0] ? "Your personal bests." : "Your records"}>
      {!cards ? <Skeleton h={160} /> : !cards.length ? <p style={{ color: OV.soft }}>No records in this period yet.</p>
        : <div className="grid gap-4 md:grid-cols-3">{cards}</div>}
    </Band>
  );
}
