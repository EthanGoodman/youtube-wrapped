/* Games Wrapped cards (Steam, Epic…), on the shared card kit. The year is told by its achievement unlocks: real,
   timestamped moments of play. Game platforms keep lifetime hours per game but not when they were played, so hours
   appear only for days the app tracked, and only on the card that says so. Nothing is estimated. */
import { motion } from "framer-motion";
import { date, num } from "../format";
import { OV } from "../overview/kit";
import { hourLabel } from "../overview/takeaways";
import { CardDef, CountUp, Personality, PersonalityStrip, SmallLabel } from "./cards";
import { Big, Kicker, Label, PosterImg, StatBox, Sticker, StreakStrip, WCard, Wordmark, fit, pop, rise } from "./kit";
import { GamesWrappedData } from "./types";

const tag = (d: GamesWrappedData) => String(d.year);
const n = (v: number, one: string, many = `${one}s`) => `${num(v)} ${v === 1 ? one : many}`;
const pctOf = (r: number | null) => (r == null ? "" : r < 1 ? "<1%" : `${r < 10 ? r.toFixed(1) : Math.round(r)}%`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

type GCard = CardDef<GamesWrappedData>;

export const GAMES_CARDS: GCard[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <WCard tone="ink" footer={false} ring="bl">
        <div className="flex flex-1 flex-col justify-center">
          <motion.div {...pop(0.1)}><Wordmark size={22} /></motion.div>
          <Big size={116} delay={0.4} hi className="mt-5 whitespace-nowrap">{d.year}</Big>
          <motion.p {...rise(0.7)} className="mt-4 font-ov-display text-[28px] font-extrabold leading-tight">Your year in games.</motion.p>
          <motion.p {...rise(1.1)} className="mt-12 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Tap to start ›</motion.p>
        </div>
      </WCard>
    ),
  },
  {
    id: "year", label: "Your year",
    when: (d) => d.unlocks > 0,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>In {d.year} you unlocked</Kicker>
        <Big size={120} delay={0.3} hi><CountUp to={d.unlocks} /></Big>
        <Big size={36} delay={0.4}>{d.unlocks === 1 ? "achievement" : "achievements"}</Big>
        <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
          <p>Across <b>{n(d.games, "game")}</b>.</p>
          <p>On <b>{n(d.active_days, "different day")}</b>.</p>
          {d.perfect.length > 0 && <p>And finished <b>{n(d.perfect.length, "game")}</b> at 100%.</p>}
        </motion.div>
        <Label delay={1.7} className="mt-auto normal-case tracking-normal">Every achievement is dated, so they tell your year.</Label>
      </WCard>
    ),
  },
  {
    id: "top-game", label: "Top game",
    when: (d) => d.top_games.length > 0,
    render: (d) => {
      const g = d.top_games[0];
      return (
        <WCard tone="mustard" tag={tag(d)}>
          <Kicker>Your most active game of {d.year}</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, rotateY: 90, scale: 0.8 }} animate={{ opacity: 1, rotateY: 0, scale: 1 }}
                        transition={{ delay: 0.8, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} className="relative">
              <PosterImg src={g.game.poster} name={g.game.title} w={176} />
              <Sticker size={64} delay={1.5}>#1</Sticker>
            </motion.div>
            <Big size={fit(g.game.title, 38)} delay={1.5} className="mt-5">{g.game.title}</Big>
            <motion.p {...rise(1.8)} className="mt-2 font-shelf-mono text-[14px]">
              {n(g.unlocks, "achievement")} · {Math.round(g.share * 100)}% of your achievements that year
            </motion.p>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "top-5", label: "Top 5 games",
    when: (d) => d.top_games.length > 1,
    render: (d) => (
      <WCard tone="paper" tag={tag(d)}>
        <Big size={40} delay={0}>Where your achievements came from</Big>
        <ol className="mt-5 flex flex-col gap-2.5">
          {d.top_games.slice(0, 5).map((g, i) => (
            <motion.li key={g.game.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <PosterImg src={g.game.poster} name={g.game.title} w={48} />
              <div className="min-w-0">
                <div className="truncate text-[18px] font-bold">{g.game.title}</div>
                <div className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{n(g.unlocks, "achievement")}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "rarest", label: "Rarest achievement",
    when: (d) => d.rarest.length > 0,
    render: (d) => {
      const a = d.rarest[0];
      return (
        <WCard tone="ink" tag={tag(d)}>
          <Kicker>Your rarest achievement</Kicker>
          <div className="flex flex-1 flex-col justify-center">
            <motion.div {...pop(0.4)} className="flex items-center gap-4">
              <PosterImg src={a.game.poster} name={a.game.title} w={96} />
              <div className="min-w-0">
                <Big size={fit(a.name, 34, 22)} delay={0.6}>{a.name}</Big>
                <motion.p {...rise(0.8)} className="mt-1 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{a.game.title} · {date(a.unlocked)}</motion.p>
              </div>
            </motion.div>
            {a.rarity != null && (
              <>
                <Big size={a.rarity < 10 ? 120 : 96} delay={1.1} hi className="mt-8 whitespace-nowrap">{pctOf(a.rarity)}</Big>
                <Kicker delay={1.3}>of players have it.</Kicker>
              </>
            )}
            {a.description && <motion.p {...rise(1.6)} className="mt-6 text-[15px]" style={{ color: OV.mute }}>“{a.description}”</motion.p>}
          </div>
        </WCard>
      );
    },
  },
  {
    id: "perfect", label: "100% games",
    when: (d) => d.perfect.length > 0,
    render: (d) => {
      const p = d.perfect;
      return (
        <WCard tone="teal" tag={tag(d)}>
          <Kicker>Every last achievement</Kicker>
          <Big size={110} delay={0.3} hi><CountUp to={p.length} /></Big>
          <Big size={34} delay={0.5}>game{p.length === 1 ? "" : "s"} at 100%</Big>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {p.slice(0, 6).map((x, i) => (
              <motion.div key={x.game.key} {...pop(0.8 + i * 0.1)} className="flex flex-col gap-1">
                <PosterImg src={x.game.poster} name={x.game.title} w={88} />
                <span className="truncate text-[12px] font-bold">{x.game.title}</span>
              </motion.div>
            ))}
          </div>
        </WCard>
      );
    },
  },
  {
    id: "clock", label: "Your hour",
    when: (d) => d.busiest_hour != null,
    render: (d) => (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>Your gaming hour</Kicker>
        <Big size={110} delay={0.3} hi className="whitespace-nowrap">{hourLabel(d.busiest_hour!)}</Big>
        <motion.p {...rise(0.7)} className="mt-2 text-[17px]">More achievements unlocked at that hour than any other.</motion.p>
        <div className="mt-8 flex h-[110px] items-end gap-[3px]" aria-hidden>
          {d.hours.map((v, h) => (
            <motion.span key={h} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.8 + h * 0.03 }}
                         className="flex-1 origin-bottom rounded-t-sm"
                         style={{ height: `${(v / Math.max(1, ...d.hours)) * 100}%`, minHeight: 2, background: h === d.busiest_hour ? OV.mustard : "#5E554A" }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-shelf-mono text-[11px]" style={{ color: OV.mute }}><span>12 AM</span><span>12 PM</span><span>11 PM</span></div>
        {d.latest_night && (
          <motion.p {...rise(1.8)} className="mt-6 text-[15px]">
            Latest night: <b>{clock(d.latest_night.unlocked)}</b>, {d.latest_night.name} in {d.latest_night.game.title}, {date(d.latest_night.unlocked)}.
          </motion.p>
        )}
      </WCard>
    ),
  },
  {
    id: "streak", label: "Streak",
    when: (d) => !!d.streak && d.streak.days > 1,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>Your longest run</Kicker>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <Big size={150} delay={0.4} hi><CountUp to={d.streak!.days} /></Big>
          <Big size={34} delay={0.6}>days in a row with an achievement</Big>
          <Label delay={0.8} className="mb-6">{date(d.streak!.start)} – {date(d.streak!.end)}</Label>
          <StreakStrip days={d.streak!.days} delay={1} />
          {d.best_day && (
            <motion.p {...rise(1.6)} className="mt-6 text-[16px]">
              Most in a day: <b>{num(d.best_day.count)}</b> in {d.best_day.game.title}, {date(d.best_day.date)}.
            </motion.p>
          )}
        </div>
      </WCard>
    ),
  },
  {
    id: "new", label: "New games",
    when: (d) => d.new_games.length > 0,
    render: (d) => (
      <WCard tone="paper" tag={tag(d)}>
        <Kicker>New to you in {d.year}</Kicker>
        <Big size={64} delay={0.3}>{n(d.new_games.length, "game")}</Big>
        <motion.p {...rise(0.6)} className="mt-1 text-[15px]" style={{ color: OV.soft }}>Your first achievement in each came this year.</motion.p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {d.new_games.slice(0, 6).map((g, i) => (
            <motion.div key={g.key} {...pop(0.8 + i * 0.1)} className="flex flex-col gap-1">
              <PosterImg src={g.poster} name={g.title} w={88} />
              <span className="truncate text-[12px] font-bold">{g.title}</span>
            </motion.div>
          ))}
        </div>
      </WCard>
    ),
  },
  {
    id: "tracked", label: "Hours tracked",
    when: (d) => !!d.tracked,
    render: (d) => (
      <WCard tone="mustard" tag={tag(d)}>
        <Kicker>Since {d.tracked_since ? date(d.tracked_since) : "tracking began"}, you played</Kicker>
        <Big size={120} delay={0.3} hi><CountUp to={Math.round(d.tracked!.est_s / 3600)} /></Big>
        <Big size={36} delay={0.4}>hours</Big>
        <motion.p {...rise(1)} className="mt-6 text-[17px]">
          On {n(d.tracked!.days, "day")}{d.tracked!.top ? <>, mostly <b>{d.tracked!.top.title}</b></> : null}.
        </motion.p>
        <Label delay={1.5} className="mt-auto normal-case tracking-normal">Counted from the day this app started checking your library.</Label>
      </WCard>
    ),
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={tag(d)} /> },
  { id: "summary", label: "Summary", render: (d) => <GamesSummary d={d} /> },
];

function GamesSummary({ d }: { d: GamesWrappedData }) {
  const rare = d.rarest[0];
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
      </div>
      <div className="mt-4"><SmallLabel>Most active games</SmallLabel></div>
      <ol className="mt-2 flex gap-2">
        {d.top_games.slice(0, 5).map((g, i) => (
          <li key={g.game.key} className="relative min-w-0">
            <PosterImg src={g.game.poster} name={g.game.title} w={54} />
            <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 font-ov-display text-[11px] font-extrabold"
                  style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatBox label="Achievements" value={num(d.unlocks)} sub={d.perfect.length ? `${d.perfect.length} at 100%` : undefined} />
        <StatBox label="Games" value={num(d.games)} sub={`${n(d.active_days, "day")} unlocking`} />
        <StatBox label={d.tracked ? "Hours tracked" : "Your hour"} value={d.tracked ? num(Math.round(d.tracked.est_s / 3600)) : d.busiest_hour != null ? hourLabel(d.busiest_hour) : "–"}
                 sub={d.tracked && d.tracked_since ? `since ${date(d.tracked_since)}` : undefined} />
        <StatBox label="Rarest" value={rare ? pctOf(rare.rarity) || rare.name : "–"} sub={rare?.name} small />
      </div>
      <PersonalityStrip p={d.personality} />
    </WCard>
  );
}
