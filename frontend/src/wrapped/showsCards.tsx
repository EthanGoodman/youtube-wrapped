/* Wrapped cards for platforms with shows (Netflix, Crunchyroll), in the shared look: same 360 x 640 cards and parts as
   YouTube's (./kit), posters instead of faces, and each platform's own words (shows / series, titles / episodes). */
import { platformName, tr } from "../platform";
import { motion } from "framer-motion";
import { compact, date, hourLabel, num } from "../format";
import { OV } from "../overview/kit";
import { CardDef, CountUp, Personality, PersonalityStrip, RadialClock, SmallLabel } from "./cards";
import { Big, GrowBar, Kicker, Label, PosterImg, StatBox, Sticker, StreakStrip, WCard, Wordmark, fit, pop, rise } from "./kit";
import { ShowsWrappedData } from "./types";

const hrs = (s: number) => Math.round(s / 3600);
const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);
const eps = (n: number) => `${num(n)} episode${n === 1 ? "" : "s"}`;

type NCard = CardDef<ShowsWrappedData>;

export const SHOWS_CARDS: NCard[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <WCard tone="ink" footer={false} ring="bl">
        <div className="flex flex-1 flex-col justify-center">
          <motion.div {...pop(0.1)}><Wordmark size={22} /></motion.div>
          <Big size={116} delay={0.4} hi className="mt-5 whitespace-nowrap">{d.year}</Big>
          <motion.p {...rise(0.7)} className="mt-4 font-ov-display text-[28px] font-extrabold leading-tight">Your year on {platformName()}.</motion.p>
          <motion.p {...rise(1.1)} className="mt-12 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Tap to start ›</motion.p>
        </div>
      </WCard>
    ),
  },
  {
    id: "time", label: "Watch time",
    render: (d) => {
      const o = d.overview;
      return (
        <WCard tone="cream" tag={String(d.year)}>
          <Kicker>In {d.year} you watched about</Kicker>
          <Big size={104} delay={0.3} hi><CountUp to={hrs(o.est_s)} /></Big>
          <Big size={36} delay={0.4}>hours of {platformName()}</Big>
          <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
            <p>That's <b>{(o.est_s / 86400).toFixed(1)} full days</b>.</p>
            <p><b>{eps(d.kind_split.episode.count)}</b> of <b>{num(d.progress.shows)} {tr("channels")}</b>
              {d.kind_split.movie.count ? <> and <b>{num(d.kind_split.movie.count)} movies</b></> : null}.</p>
            <p>You pressed play on <b>{num(o.active_days)} of {o.days} days</b>.</p>
          </motion.div>
          {!d.has_times && (
            <Label delay={1.7} className="mt-auto normal-case tracking-normal">
              Estimated from each episode's and movie's runtime: {platformName() === "Netflix" ? "Netflix's quick download" : `your ${platformName()} history`} has no watch times.
            </Label>
          )}
        </WCard>
      );
    },
  },
  {
    id: "top-show", get label() { return tr("Top channel"); },
    when: (d) => d.top_channels.length > 0,
    render: (d) => {
      const s = d.top_channels[0];
      return (
        <WCard tone="mustard" tag={String(d.year)}>
          <Kicker>{tr("Your #1 channel of")} {d.year} was…</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, rotateY: 90, scale: 0.8 }} animate={{ opacity: 1, rotateY: 0, scale: 1 }}
                        transition={{ delay: 0.8, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} className="relative">
              <PosterImg src={s.avatar_url} name={s.title} w={176} big />
              <Sticker size={64} delay={1.5}>#1</Sticker>
            </motion.div>
            <Big size={fit(s.title, 38)} delay={1.5} className="mt-5">{s.title}</Big>
            <motion.p {...rise(1.8)} className="mt-2 font-shelf-mono text-[14px]">{eps(s.count)} · about {num(hrs(s.time_s))} hours</motion.p>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "top-5", get label() { return tr("Top 5 channels"); },
    when: (d) => d.top_channels.length > 1,
    render: (d) => (
      <WCard tone="paper" tag={String(d.year)}>
        <Big size={40} delay={0}>{tr("Your top 5 channels")}</Big>
        <ol className="mt-5 flex flex-col gap-2.5">
          {d.top_channels.slice(0, 5).map((s, i) => (
            <motion.li key={s.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <PosterImg src={s.avatar_url} name={s.title} w={50} />
              <div className="min-w-0">
                <div className="truncate text-[18px] font-bold">{s.title}</div>
                <div className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{eps(s.count)}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "binge", label: "Fastest season",
    when: (d) => !!d.binge,
    render: (d) => {
      const b = d.binge!;
      return (
        <WCard tone="ink" tag={String(d.year)}>
          <Kicker>Your fastest binge</Kicker>
          <div className="mt-5 flex items-end gap-4">
            <motion.div {...pop(0.4)}><PosterImg src={b.avatar_url} name={b.title} w={120} big /></motion.div>
            <div className="min-w-0 pb-1">
              <Big size={fit(b.title, 32, 22)} delay={0.7}>{b.title}</Big>
              <motion.p {...rise(0.9)} className="mt-1 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Season {b.season} · {eps(b.episodes)}</motion.p>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <Big size={Math.min(100, Math.round(300 / (days(b.days).length * 0.6)))} delay={1.2} hi className="whitespace-nowrap">{days(b.days)}</Big>
            <Kicker delay={1.4}>start to finish. That's {eps(Math.round(b.per_day * 10) / 10)} a day.</Kicker>
          </div>
          {d.episode_day && (
            <motion.p {...rise(1.8)} className="rounded-xl border-2 px-4 py-3 text-[14px]" style={{ borderColor: OV.paper, background: "rgba(251,246,236,0.08)" }}>
              Most in one day: <b>{eps(d.episode_day.episodes)}</b> of {d.episode_day.title} on {date(d.episode_day.date)}.
            </motion.p>
          )}
        </WCard>
      );
    },
  },
  {
    id: "finished", label: "Finished vs dropped",
    when: (d) => d.progress.shows > 0,
    render: (d) => {
      const s = d.progress.summary;
      const rows: [string, number, string, string][] = [["Finished", s.finished, OV.teal, OV.paper], ["Still watching", s.watching, OV.mustard, OV.ink], ["Dropped", s.dropped, OV.sand, OV.ink]];
      return (
        <WCard tone="cream" tag={String(d.year)}>
          <Kicker>You started</Kicker>
          <Big size={80} delay={0.3}><CountUp to={d.progress.shows} /> {tr("channels")}</Big>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {rows.map(([label, n, bg, fg], i) => (
              <motion.div key={label} {...rise(0.7 + i * 0.15)} className="rounded-xl border-2 px-3 py-3" style={{ background: bg, color: fg, borderColor: OV.ink }}>
                <div className="font-ov-display text-[34px] font-extrabold leading-none">{num(n)}</div>
                <div className="mt-1 text-[12px] font-bold">{label}</div>
              </motion.div>
            ))}
          </div>
          {d.progress.finished.length > 0 && (
            <>
              <Label delay={1.3} className="mt-7">Seen through to the end</Label>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {d.progress.finished.slice(0, 8).map((f, i) => (
                  <motion.div key={f.key} {...pop(1.5 + i * 0.08)}><PosterImg src={f.avatar_url} name={f.title} w={66} /></motion.div>
                ))}
              </div>
            </>
          )}
        </WCard>
      );
    },
  },
  {
    id: "split", label: "Episodes vs movies",
    when: (d) => d.kind_split.movie.count > 0 && d.kind_split.episode.count > 0,
    render: (d) => {
      const { episode, movie } = d.kind_split;
      const total = episode.est_s + movie.est_s || 1;
      const m = d.top_movies[0];
      return (
        <WCard tone="teal" tag={String(d.year)}>
          <Kicker>{tr("Channels or movies?")}</Kicker>
          <Big size={112} delay={0.3} hi><CountUp to={Math.round((episode.est_s / total) * 100)} format={(n) => `${Math.round(n)}%`} /></Big>
          <Kicker delay={0.5}>{tr("of your watch time was channels")}</Kicker>
          <div className="mt-7 flex flex-col gap-4">
            <GrowBar label={`Episodes · ${compact(episode.count)}`} value={`${num(hrs(episode.est_s))}h`} share={episode.est_s / total} delay={0.8} color={OV.mustard} />
            <GrowBar label={`Movies · ${compact(movie.count)}`} value={`${num(hrs(movie.est_s))}h`} share={movie.est_s / total} delay={1} color={OV.paper} />
          </div>
          {m && (
            <motion.div {...rise(1.5)} className="mt-auto flex items-center gap-4 rounded-xl border-2 p-3" style={{ borderColor: OV.paper, background: "rgba(251,246,236,0.12)" }}>
              <PosterImg src={m.thumb} name={m.title} w={56} />
              <div className="min-w-0">
                <Label>{d.top_movies.length > 1 ? "A movie you watched" : "Your movie of the year"}</Label>
                <p className="line-clamp-2 font-ov-display text-[19px] font-extrabold leading-tight">{m.title}</p>
              </div>
            </motion.div>
          )}
        </WCard>
      );
    },
  },
  {
    id: "anime", label: "Sub, dub and studio",
    when: (d) => !!d.anime && d.anime.sub + d.anime.dub > 0,
    render: (d) => {
      const a = d.anime!;
      const total = a.sub + a.dub;
      const sub = Math.round((a.sub / total) * 100);
      return (
        <WCard tone="ink" tag={String(d.year)}>
          <Kicker>Sub or dub?</Kicker>
          <Big size={112} delay={0.3} hi><CountUp to={sub} format={(n) => `${Math.round(n)}%`} /></Big>
          <Kicker delay={0.5}>{sub >= 50 ? "of your episodes were subbed" : "of your episodes were subbed. Team dub!"}</Kicker>
          <div className="mt-5 flex h-4 overflow-hidden rounded-full border-2" style={{ borderColor: OV.paper }}>
            <motion.div style={{ background: OV.mustard }} initial={{ width: 0 }} animate={{ width: `${sub}%` }} transition={{ delay: 0.8, duration: 1 }} />
            <motion.div style={{ background: OV.teal }} initial={{ width: 0 }} animate={{ width: `${100 - sub}%` }} transition={{ delay: 1, duration: 1 }} />
          </div>
          <div className="mt-2 flex justify-between font-shelf-mono text-[12px]" style={{ color: OV.mute }}><span>{num(a.sub)} subbed</span><span>{num(a.dub)} dubbed</span></div>
          {a.studio && (
            <motion.div {...rise(1.4)} className="mt-7">
              <Label>Your studio</Label>
              <p className="mt-1 font-ov-display text-[30px] font-extrabold leading-none">{a.studio.name}</p>
              <p className="mt-1 font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{eps(a.studio.count)}</p>
              <div className="mt-3 flex gap-2">{a.studio.series.slice(0, 4).map((s) => <PosterImg key={s.key} src={s.poster} name={s.title} w={56} />)}</div>
            </motion.div>
          )}
          {a.simulcast > 0 && (
            <motion.p {...rise(1.9)} className="mt-auto rounded-xl border-2 px-4 py-3 text-[14px]" style={{ borderColor: OV.paper, background: "rgba(251,246,236,0.08)" }}>
              <b>{eps(a.simulcast)}</b> watched within a week of airing{a.simulcast_series[0] ? <>, mostly {a.simulcast_series[0].title}</> : null}.
            </motion.p>
          )}
        </WCard>
      );
    },
  },
  {
    id: "genres", label: "Top genres",
    when: (d) => d.top_genres.length > 0,
    render: (d) => (
      <WCard tone="mustard" tag={String(d.year)}>
        <Kicker>You couldn't get enough of</Kicker>
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
    id: "clock", label: "Watch clock",
    when: (d) => d.has_times && d.clock.length > 0,
    render: (d) => (
      <WCard tone="ink" tag={String(d.year)}>
        <Kicker>When you pressed play</Kicker>
        <Big size={36} delay={0.2}>Peak hour: <span style={{ color: OV.mustard }}>{hourLabel(d.peak_hour ?? 0)}</span></Big>
        <div className="flex flex-1 items-center justify-center">
          <RadialClock data={d.clock.map((h) => h.count)} peak={d.peak_hour ?? 0} />
        </div>
      </WCard>
    ),
  },
  {
    id: "biggest-day", label: "Biggest day",
    when: (d) => !!d.biggest_day,
    render: (d) => (
      <WCard tone="teal" tag={String(d.year)}>
        <Kicker>Your biggest day was</Kicker>
        <Big size={44} delay={0.3}>{date(d.biggest_day!.date)}</Big>
        <div className="flex flex-1 flex-col justify-center">
          <Big size={140} delay={0.7} hi><CountUp to={d.biggest_day!.count} /></Big>
          <Kicker delay={0.9}>{tr("videos")} in a single day</Kicker>
          {d.streak && d.streak.days > 1 && (
            <motion.div {...rise(1.4)} className="mt-8 flex flex-col gap-3">
              <p className="text-[16px]">Longest streak: <b>{days(d.streak.days)}</b> in a row, {date(d.streak.start)} – {date(d.streak.end)}.</p>
              <StreakStrip days={d.streak.days} delay={1.6} />
            </motion.div>
          )}
        </div>
      </WCard>
    ),
  },
  {
    id: "discovery", get label() { return tr("New channel"); },
    when: (d) => !!d.discovery,
    render: (d) => {
      const s = d.discovery!;
      return (
        <WCard tone="cream" tag={String(d.year)}>
          <Kicker>New to you this year</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.5)} className="relative">
              <PosterImg src={s.avatar_url} name={s.title} w={160} big />
              <Sticker size={60} delay={1}>New</Sticker>
            </motion.div>
            <Big size={fit(s.title, 36)} delay={1} className="mt-5">{s.title}</Big>
            <motion.p {...rise(1.3)} className="mt-2 text-[16px]" style={{ color: OV.soft }}>
              First episode {date(s.first_watched)}, then {num(s.count)} in total.
            </motion.p>
          </div>
        </WCard>
      );
    },
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={String(d.year)} /> },
  { id: "summary", label: "Summary", render: (d) => <ShowsSummary d={d} /> },
];

function ShowsSummary({ d }: { d: ShowsWrappedData }) {
  const s = d.progress.summary;
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
      </div>
      <div className="mt-4"><SmallLabel>{tr("Top channels")}</SmallLabel></div>
      <ol className="mt-2 flex gap-2">
        {d.top_channels.slice(0, 5).map((c, i) => (
          <li key={c.key} className="relative min-w-0">
            <PosterImg src={c.avatar_url} name={c.title} w={54} />
            <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 font-ov-display text-[11px] font-extrabold"
                  style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatBox label="Hours watched" value={num(hrs(d.overview.est_s))} sub={d.has_times ? undefined : "estimated"} />
        <StatBox label={tr("Videos")} value={compact(d.overview.videos)} sub={tr(`${num(d.progress.shows)} channels`) + (d.kind_split.movie.count ? ` · ${num(d.kind_split.movie.count)} movies` : "")} />
        <StatBox label={tr("Channels finished")} value={num(s.finished)} sub={`${num(s.dropped)} dropped`} />
        <StatBox label="Fastest season" value={d.binge ? days(d.binge.days) : "–"} sub={d.binge?.title} />
      </div>
      {d.top_genres[0] && (
        <div className="mt-2 rounded-xl border-2 px-3 py-2" style={{ borderColor: OV.ink, background: OV.paper }}>
          <SmallLabel>Top genres</SmallLabel>
          <p className="truncate text-[15px] font-bold">{d.top_genres.slice(0, 3).map((g) => g.title).join(" · ")}</p>
        </div>
      )}
      <PersonalityStrip p={d.personality} />
    </WCard>
  );
}
