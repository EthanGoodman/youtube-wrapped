/* Games Wrapped cards (Steam, and later other game platforms), on the shared card kit: hours played, your #1 game,
   top 5, achievements (the rarest, 100% games), genres, streak, a new game, personality and summary. Hours before the
   app's first daily snapshot are estimates; the hours card says so. */
import { motion } from "framer-motion";
import { date, num } from "../format";
import { OV } from "../overview/kit";
import { CardDef, CountUp, Personality, PersonalityStrip, SmallLabel } from "./cards";
import { Big, Kicker, Label, PosterImg, StatBox, Sticker, StreakStrip, WCard, Wordmark, fit, pop, rise } from "./kit";
import { GamesWrappedData } from "./types";

const hrs = (s: number) => Math.round(s / 3600);
const tag = (d: GamesWrappedData) => String(d.year);
const days = (n: number) => `${num(n)} day${n === 1 ? "" : "s"}`;
const rarity = (r: number | null) => (r == null ? "" : r < 1 ? "under 1% of players" : `${r < 10 ? r.toFixed(1) : Math.round(r)}% of players`);

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
    id: "hours", label: "Hours played",
    render: (d) => {
      const o = d.overview;
      const since = d.tracked_since;
      // a year before tracking started: all estimated; the year it started: estimated up to that day
      const note = !since || since <= `${d.year}-01-01` ? null
        : since > `${d.year}-12-31` ? `Estimated from the days you earned achievements (the app's daily check started ${date(since)}).`
        : `Exact from ${date(since)}; earlier hours are estimated from the days you earned achievements.`;
      return (
        <WCard tone="cream" tag={tag(d)}>
          <Kicker>In {d.year} you played for about</Kicker>
          <Big size={110} delay={0.3} hi><CountUp to={hrs(o.est_s)} /></Big>
          <Big size={36} delay={0.4}>hours</Big>
          <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
            <p>Across <b>{num(o.unique_channels)} game{o.unique_channels === 1 ? "" : "s"}</b>.</p>
            <p>You played on <b>{num(o.active_days)} of {o.days} days</b>.</p>
            <p>And unlocked <b>{num(d.achievements.unlocked)} achievements</b>.</p>
          </motion.div>
          {note && <Label delay={1.7} className="mt-auto normal-case tracking-normal">{note}</Label>}
        </WCard>
      );
    },
  },
  {
    id: "top-game", label: "Top game",
    when: (d) => d.top_games.length > 0,
    render: (d) => {
      const g = d.top_games[0];
      return (
        <WCard tone="mustard" tag={tag(d)}>
          <Kicker>Your #1 game of {d.year} was…</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, rotateY: 90, scale: 0.8 }} animate={{ opacity: 1, rotateY: 0, scale: 1 }}
                        transition={{ delay: 0.8, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} className="relative">
              <PosterImg src={g.avatar_url} name={g.title} w={176} />
              <Sticker size={64} delay={1.5}>#1</Sticker>
            </motion.div>
            <Big size={fit(g.title, 38)} delay={1.5} className="mt-5">{g.title}</Big>
            <motion.p {...rise(1.8)} className="mt-2 font-shelf-mono text-[14px]">{num(hrs(g.time_s))} hours · {days(g.count)} played</motion.p>
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
        <Big size={40} delay={0}>Your top games</Big>
        <ol className="mt-5 flex flex-col gap-2.5">
          {d.top_games.slice(0, 5).map((g, i) => (
            <motion.li key={g.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <PosterImg src={g.avatar_url} name={g.title} w={48} />
              <div className="min-w-0">
                <div className="truncate text-[18px] font-bold">{g.title}</div>
                <div className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{num(hrs(g.time_s))} hours</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "rarest", label: "Rarest achievement",
    when: (d) => d.achievements.rarest.length > 0,
    render: (d) => {
      const a = d.achievements.rarest[0];
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
                <Big size={a.rarity < 10 ? 120 : 96} delay={1.1} hi className="mt-8 whitespace-nowrap">
                  {a.rarity < 1 ? "<1%" : `${a.rarity < 10 ? a.rarity.toFixed(1) : Math.round(a.rarity)}%`}
                </Big>
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
    when: (d) => d.achievements.perfect.length > 0,
    render: (d) => {
      const p = d.achievements.perfect;
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
    id: "genres", label: "Top genres",
    when: (d) => d.top_genres.length > 0,
    render: (d) => (
      <WCard tone="mustard" tag={tag(d)}>
        <Kicker>You mostly played</Kicker>
        <Big size={fit(d.top_genres[0].title, 70)} delay={0.3}>{d.top_genres[0].title}</Big>
        <ol className="mt-8 flex flex-col gap-2.5">
          {d.top_genres.slice(1, 5).map((g, i) => (
            <motion.li key={g.key} {...rise(0.8 + i * 0.15)} className="flex items-center gap-4 rounded-xl border-2 px-4 py-3"
                       style={{ borderColor: OV.ink, background: "rgba(251,246,236,0.45)" }}>
              <span className="w-6 font-ov-display text-[22px] font-extrabold leading-none">{i + 2}</span>
              <span className="text-[18px] font-bold">{g.title}</span>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "streak", label: "Streak",
    when: (d) => !!d.streak && d.streak.days > 1,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>Your longest streak</Kicker>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <Big size={150} delay={0.4} hi><CountUp to={d.streak!.days} /></Big>
          <Big size={34} delay={0.6}>days of play in a row</Big>
          <Label delay={0.8} className="mb-6">{date(d.streak!.start)} – {date(d.streak!.end)}</Label>
          <StreakStrip days={d.streak!.days} delay={1} />
          {d.achievements.best_day && (
            <motion.p {...rise(1.6)} className="mt-6 text-[16px]">
              Most achievements in a day: <b>{num(d.achievements.best_day.count)}</b> in {d.achievements.best_day.game.title}, {date(d.achievements.best_day.date)}.
            </motion.p>
          )}
        </div>
      </WCard>
    ),
  },
  {
    id: "discovery", label: "New game",
    when: (d) => !!d.discovery,
    render: (d) => {
      const s = d.discovery!;
      return (
        <WCard tone="paper" tag={tag(d)}>
          <Kicker>New to you this year</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.5)} className="relative">
              <PosterImg src={s.avatar_url} name={s.title} w={160} />
              <Sticker size={60} delay={1}>New</Sticker>
            </motion.div>
            <Big size={fit(s.title, 36)} delay={1} className="mt-5">{s.title}</Big>
            <motion.p {...rise(1.3)} className="mt-2 text-[16px]" style={{ color: OV.soft }}>
              First played {date(s.first_watched)}, then {num(hrs(s.time_s))} hours of it.
            </motion.p>
          </div>
        </WCard>
      );
    },
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={tag(d)} /> },
  { id: "summary", label: "Summary", render: (d) => <GamesSummary d={d} /> },
];

function GamesSummary({ d }: { d: GamesWrappedData }) {
  const rare = d.achievements.rarest[0];
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
      </div>
      <div className="mt-4"><SmallLabel>Top games</SmallLabel></div>
      <ol className="mt-2 flex gap-2">
        {d.top_games.slice(0, 5).map((g, i) => (
          <li key={g.key} className="relative min-w-0">
            <PosterImg src={g.avatar_url} name={g.title} w={54} />
            <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 font-ov-display text-[11px] font-extrabold"
                  style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatBox label="Hours played" value={num(hrs(d.overview.est_s))} sub={d.estimated ? "partly estimated" : undefined} />
        <StatBox label="Games" value={num(d.overview.unique_channels)} sub={`${days(d.overview.active_days)} played`} />
        <StatBox label="Achievements" value={num(d.achievements.unlocked)} sub={d.achievements.perfect.length ? `${d.achievements.perfect.length} at 100%` : undefined} />
        <StatBox label="Rarest" value={rare ? rarity(rare.rarity) || rare.name : "–"} sub={rare?.name} small />
      </div>
      <PersonalityStrip p={d.personality} />
    </WCard>
  );
}
