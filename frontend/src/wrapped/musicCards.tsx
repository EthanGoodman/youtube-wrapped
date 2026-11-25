/* Music Wrapped cards (Spotify, and later other music platforms), on the shared card kit: minutes, your #1 artist,
   top 5 songs, top album, genres, the listening clock, on repeat, streak, a new artist, personality and summary.
   Streams are plays of 30 seconds or more. */
import { motion } from "framer-motion";
import { compact, date, hourLabel, num } from "../format";
import { OV } from "../overview/kit";
import { CardDef, CountUp, Personality, PersonalityStrip, RadialClock, SmallLabel } from "./cards";
import { Big, CoverImg, Face, Kicker, Label, StatBox, Sticker, StreakStrip, WCard, Wordmark, fit, pop, rise } from "./kit";
import { MusicWrappedData } from "./types";

const streams = (n: number) => `${num(n)} stream${n === 1 ? "" : "s"}`;
const tag = (d: MusicWrappedData) => String(d.year);

type MCard = CardDef<MusicWrappedData>;

export const MUSIC_CARDS: MCard[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <WCard tone="ink" footer={false} ring="bl">
        <div className="flex flex-1 flex-col justify-center">
          <motion.div {...pop(0.1)}><Wordmark size={22} /></motion.div>
          <Big size={116} delay={0.4} hi className="mt-5 whitespace-nowrap">{d.year}</Big>
          <motion.p {...rise(0.7)} className="mt-4 font-ov-display text-[28px] font-extrabold leading-tight">Your year in music.</motion.p>
          <motion.p {...rise(1.1)} className="mt-12 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Tap to start ›</motion.p>
        </div>
      </WCard>
    ),
  },
  {
    id: "minutes", label: "Minutes",
    render: (d) => {
      const o = d.overview;
      return (
        <WCard tone="cream" tag={tag(d)}>
          <Kicker>In {d.year} you listened for</Kicker>
          <Big size={fit(num(Math.round(o.est_s / 60)), 96, 60)} delay={0.3} hi><CountUp to={Math.round(o.est_s / 60)} /></Big>
          <Big size={36} delay={0.4}>minutes</Big>
          <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
            <p>That's <b>{(o.est_s / 86400).toFixed(1)} full days</b> of music.</p>
            <p><b>{streams(o.videos)}</b> of <b>{num(o.unique_videos)} songs</b> by <b>{num(o.unique_channels)} artists</b>.</p>
            <p>You pressed play on <b>{num(o.active_days)} of {o.days} days</b>.</p>
          </motion.div>
        </WCard>
      );
    },
  },
  {
    id: "top-artist", label: "Top artist",
    when: (d) => d.top_artists.length > 0,
    render: (d) => {
      const a = d.top_artists[0];
      return (
        <WCard tone="mustard" tag={tag(d)}>
          <Kicker>Your #1 artist of {d.year} was…</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, scale: 0.3, rotate: -16 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        transition={{ delay: 0.8, type: "spring", stiffness: 120, damping: 12 }} className="relative">
              <Face src={a.avatar_url} name={a.title} size={196} />
              <Sticker size={66} delay={1.4}>#1</Sticker>
            </motion.div>
            <Big size={fit(a.title, 38)} delay={1.5} className="mt-6">{a.title}</Big>
            <motion.div {...rise(1.8)} className="mt-2 font-shelf-mono text-[14px]">{num(Math.round(a.time_s / 60))} minutes · {streams(a.count)}</motion.div>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "top-songs", label: "Top 5 songs",
    when: (d) => d.top_tracks.length > 1,
    render: (d) => (
      <WCard tone="paper" tag={tag(d)}>
        <Big size={40} delay={0}>Your top songs</Big>
        <ol className="mt-5 flex flex-col gap-3">
          {d.top_tracks.slice(0, 5).map((s, i) => (
            <motion.li key={s.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <CoverImg src={s.thumb} name={s.title} w={54} />
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold">{s.title}</div>
                <div className="truncate font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{s.channel} · {streams(s.count)}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "top-album", label: "Top album",
    when: (d) => d.top_albums.length > 0,
    render: (d) => {
      const a = d.top_albums[0];
      return (
        <WCard tone="ink" tag={tag(d)}>
          <Kicker>The album you lived in</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.5)}><CoverImg src={a.cover} name={a.title} w={220} /></motion.div>
            <Big size={fit(a.title, 32, 20)} delay={1} className="mt-6">{a.title}</Big>
            <motion.p {...rise(1.3)} className="mt-2 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>
              {a.artist} · {num(Math.round(a.time_s / 60))} minutes
            </motion.p>
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
        <Kicker>Your sound was</Kicker>
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
    id: "clock", label: "Listening clock",
    render: (d) => (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>When you pressed play</Kicker>
        <Big size={36} delay={0.2}>Peak hour: <span style={{ color: OV.mustard }}>{hourLabel(d.peak_hour)}</span></Big>
        <div className="flex flex-1 items-center justify-center">
          <RadialClock data={d.clock.map((h) => h.count)} peak={d.peak_hour} />
        </div>
      </WCard>
    ),
  },
  {
    id: "on-repeat", label: "On repeat",
    when: (d) => !!d.on_repeat,
    render: (d) => {
      const r = d.on_repeat!;
      return (
        <WCard tone="teal" tag={tag(d)}>
          <Kicker>The song you couldn't stop playing</Kicker>
          <motion.div {...pop(0.4)} className="mt-6 flex items-center gap-4">
            <CoverImg src={r.cover} name={r.title} w={110} />
            <div className="min-w-0">
              <Big size={fit(r.title, 30, 20)} delay={0.6}>{r.title}</Big>
              <motion.p {...rise(0.8)} className="mt-1 font-shelf-mono text-[13px]" style={{ color: "#CFE3DE" }}>{r.artist}</motion.p>
            </div>
          </motion.div>
          <div className="flex flex-1 flex-col justify-center">
            <Big size={140} delay={1.1} hi><CountUp to={r.count} format={(n) => `${Math.round(n)}×`} /></Big>
            <Kicker delay={1.3}>in a single day, {date(r.date)}.</Kicker>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "streak", label: "Streak",
    when: (d) => !!d.streak && d.streak.days > 1,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>Your longest streak</Kicker>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <Big size={150} delay={0.4} hi><CountUp to={d.streak!.days} /></Big>
          <Big size={34} delay={0.6}>days of music in a row</Big>
          <Label delay={0.8} className="mb-6">{date(d.streak!.start)} – {date(d.streak!.end)}</Label>
          <StreakStrip days={d.streak!.days} delay={1} />
          {d.biggest_day && (
            <motion.p {...rise(1.6)} className="mt-6 text-[16px]">Biggest day: <b>{streams(d.biggest_day.count)}</b> on {date(d.biggest_day.date)}.</motion.p>
          )}
        </div>
      </WCard>
    ),
  },
  {
    id: "discovery", label: "New artist",
    when: (d) => !!d.discovery,
    render: (d) => {
      const s = d.discovery!;
      return (
        <WCard tone="paper" tag={tag(d)}>
          <Kicker>Your discovery of the year</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.5)} className="relative">
              <Face src={s.avatar_url} name={s.title} size={176} />
              <Sticker size={60} delay={1}>New</Sticker>
            </motion.div>
            <Big size={fit(s.title, 36)} delay={1} className="mt-6">{s.title}</Big>
            <motion.p {...rise(1.3)} className="mt-2 text-[16px]" style={{ color: OV.soft }}>
              First played {date(s.first_watched)}, then {num(Math.round(s.time_s / 60))} minutes of them.
            </motion.p>
          </div>
        </WCard>
      );
    },
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={tag(d)} /> },
  { id: "summary", label: "Summary", render: (d) => <MusicSummary d={d} /> },
];

function MusicSummary({ d }: { d: MusicWrappedData }) {
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4">
        <div>
          <SmallLabel>Top artists</SmallLabel>
          <ol className="mt-2 space-y-1.5">
            {d.top_artists.slice(0, 5).map((a, i) => (
              <li key={a.key} className="flex items-center gap-2">
                <span className="w-3 font-ov-display text-[13px] font-extrabold">{i + 1}</span>
                <Face src={a.avatar_url} name={a.title} size={28} />
                <span className="truncate text-[13px] font-bold">{a.title}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <SmallLabel>Top songs</SmallLabel>
          <ol className="mt-2 space-y-1.5">
            {d.top_tracks.slice(0, 5).map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="w-3 font-ov-display text-[13px] font-extrabold">{i + 1}</span>
                <CoverImg src={s.thumb} name={s.title} w={28} />
                <span className="truncate text-[13px] font-bold">{s.title}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatBox label="Minutes listened" value={compact(Math.round(d.overview.est_s / 60))} />
        <StatBox label="Streams" value={compact(d.overview.videos)} sub={`${num(d.overview.unique_channels)} artists`} />
        <StatBox label="Top genre" value={d.top_genres[0]?.title ?? "–"} small />
        <StatBox label="Longest streak" value={d.streak ? `${d.streak.days} days` : "–"} />
      </div>
      <PersonalityStrip p={d.personality} />
    </WCard>
  );
}
