/* Netflix Wrapped cards: same 360 x 640 design size and player as YouTube's, Netflix look
   (near-black, Netflix red, heavy Inter headlines, posters instead of avatars). */
import { ReactNode, useState } from "react";
import { motion } from "framer-motion";
import { compact, date, hourLabel, num } from "../format";
import { CardDef, CountUp, RadialClock, pop, rise } from "./cards";
import { NetflixWrappedData, img } from "./types";

const RED = "#e50914";
// Inter Black, like the dashboard (Netflix's own type is a heavy sans, not a condensed display face)
const DISPLAY = "Inter, system-ui, sans-serif";
/** Inter is much wider than the condensed face these sizes were set for: scale headlines to fit. */
const FIT = 0.74;
const heavy = { fontFamily: DISPLAY, fontWeight: 900, letterSpacing: "-0.035em" } as const;
const hrs = (s: number) => Math.round(s / 3600);
const days = (n: number) => (n === 1 ? "1 day" : `${num(n)} days`);
/** TMDB posters: ask for a bigger size when shown big. */
const poster = (url: string | null | undefined, big = false) => img(big && url ? url.replace("/w185/", "/w500/") : url);

// ------------------------------------------------------------------ building blocks

/** Our own mark (not Netflix's N), shared with the dashboard's top bar. */
import { WrappedMark as NMark } from "../components/NetflixShell";
export { NMark };

function Card({ children, footer = true, year, glow = "top" }: {
  children: ReactNode; footer?: boolean; year?: number; glow?: "top" | "bottom" | "center" | "none";
}) {
  const glowAt = { top: "50% -10%", bottom: "50% 115%", center: "50% 45%", none: "" }[glow];
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden text-white"
         style={{ background: "#0b0b0b", fontFamily: "Inter, system-ui, sans-serif" }}>
      {glow !== "none" && (
        <div className="pointer-events-none absolute inset-0"
             style={{ background: `radial-gradient(ellipse 120% 70% at ${glowAt}, rgba(229,9,20,0.55), rgba(229,9,20,0.08) 55%, transparent 75%)` }} />
      )}
      <div className="relative z-10 flex flex-1 flex-col px-7 pb-6 pt-16">{children}</div>
      {footer && (
        <div className="relative z-10 flex items-center justify-between px-7 pb-6">
          <span className="flex items-center gap-2"><NMark size={18} />
            <span className="text-[15px] font-extrabold tracking-tight">Netflix Wrapped</span>
          </span>
          {year && <span className="text-[15px] font-extrabold text-white/70">{year}</span>}
        </div>
      )}
    </div>
  );
}

function Kicker({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return <motion.p {...rise(delay)} className="text-[17px] font-medium leading-snug text-white/80">{children}</motion.p>;
}

/** Heavy headline (Inter Black). */
function Display({ children, size = 64, delay = 0.2, color, className = "" }: {
  children: ReactNode; size?: number; delay?: number; color?: string; className?: string;
}) {
  return (
    <motion.div {...rise(delay)} className={`leading-[0.95] ${className}`}
                style={{ ...heavy, fontSize: Math.round(size * FIT), color }}>
      {children}
    </motion.div>
  );
}

function Poster({ src, name, w, big = false, className = "" }: {
  src?: string | null; name?: string | null; w: number; big?: boolean; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = poster(src, big);
  const h = Math.round(w * 1.5);
  if (!url || failed)
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-md bg-white/10 px-2 text-center ${className}`}
           style={{ width: w, height: h, ...heavy, fontSize: Math.max(12, w / 7) }}>
        {name ?? "?"}
      </div>
    );
  return <img src={url} alt="" onError={() => setFailed(true)} className={`shrink-0 rounded-md object-cover ${className}`} style={{ width: w, height: h }} />;
}

/** Outlined rank number, the same numeral as the dashboard's Top 10 rows (SVG, so it exports cleanly). */
function Rank({ n, size }: { n: number; size: number }) {
  return (
    <svg viewBox="0 0 100 150" width={size * 0.66} height={size} aria-hidden className="shrink-0">
      <text x={n >= 10 ? 52 : 60} y="140" textAnchor="middle" fontSize="150" fontWeight="900" letterSpacing="-14"
            fontFamily="Inter, sans-serif" fill="#0b0b0b" stroke="rgba(255,255,255,0.7)" strokeWidth="4" paintOrder="stroke fill">
        {n}
      </text>
    </svg>
  );
}

// ------------------------------------------------------------------ cards

type NCard = CardDef<NetflixWrappedData>;

export const NETFLIX_CARDS: NCard[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <Card footer={false} glow="center">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div {...pop(0.1)}><NMark size={96} /></motion.div>
          <Display size={150} delay={0.4} className="mt-4">{d.year}</Display>
          <motion.p {...rise(0.7)} className="mt-1 text-[21px] font-bold">Your year on Netflix</motion.p>
          <motion.p {...rise(1.1)} className="mt-10 text-sm text-white/60">Tap to start ▸</motion.p>
        </div>
      </Card>
    ),
  },
  {
    id: "time", label: "Watch time",
    render: (d) => {
      const o = d.overview;
      return (
        <Card year={d.year}>
          <Kicker>In {d.year} you watched about</Kicker>
          <Display size={140} delay={0.3} color={RED}><CountUp to={hrs(o.est_s)} /></Display>
          <Display size={44} delay={0.4}>hours of Netflix</Display>
          <motion.div {...rise(1.1)} className="mt-8 space-y-3 text-[17px]">
            <p>That's <b>{(o.est_s / 86400).toFixed(1)} full days</b>.</p>
            <p><b>{num(d.kind_split.episode.count)} episodes</b> of <b>{num(d.progress.shows)} shows</b>
              {d.kind_split.movie.count ? <> and <b>{num(d.kind_split.movie.count)} movies</b></> : null}.</p>
            <p>You pressed play on <b>{num(o.active_days)} of {o.days} days</b>.</p>
          </motion.div>
          {!d.has_times && (
            <motion.p {...rise(1.7)} className="mt-auto text-[11px] text-white/50">
              Estimated from each episode's and movie's runtime: Netflix's quick download has no watch times.
            </motion.p>
          )}
        </Card>
      );
    },
  },
  {
    id: "top-show", label: "Top show",
    when: (d) => d.top_channels.length > 0,
    render: (d) => {
      const s = d.top_channels[0];
      return (
        <Card year={d.year} glow="center">
          <Kicker>Your #1 show of {d.year}</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, rotateY: 90, scale: 0.8 }} animate={{ opacity: 1, rotateY: 0, scale: 1 }}
                        transition={{ delay: 0.8, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{ boxShadow: "0 20px 60px rgba(229,9,20,0.45)" }} className="rounded-md">
              <Poster src={s.avatar_url} name={s.title} w={196} big />
            </motion.div>
            <Display size={44} delay={1.5} className="mt-6">{s.title}</Display>
            <motion.p {...rise(1.8)} className="mt-2 text-[16px] text-white/80">
              {num(s.count)} episodes · about {num(hrs(s.time_s))} hours
            </motion.p>
          </div>
        </Card>
      );
    },
  },
  {
    id: "top-5", label: "Top 5 shows",
    when: (d) => d.top_channels.length > 1,
    render: (d) => (
      <Card year={d.year}>
        <Display size={46} delay={0}>Your Top 5 shows</Display>
        <div className="mt-4 flex flex-col gap-2">
          {d.top_channels.slice(0, 5).map((s, i) => (
            <motion.div key={s.key} {...rise(0.3 + i * 0.18)} className="flex items-center">
              <div className="flex w-[66px] justify-end"><Rank n={i + 1} size={76} /></div>
              <Poster src={s.avatar_url} name={s.title} w={48} className="-ml-3 relative" />
              <div className="ml-3 min-w-0">
                <div className="truncate text-[17px] font-bold">{s.title}</div>
                <div className="text-[13px] text-white/65">{num(s.count)} episodes</div>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    ),
  },
  {
    id: "binge", label: "Fastest season",
    when: (d) => !!d.binge,
    render: (d) => {
      const b = d.binge!;
      return (
        <Card year={d.year} glow="bottom">
          <Kicker>Your fastest binge</Kicker>
          <div className="mt-6 flex items-end gap-5">
            <motion.div {...pop(0.4)}><Poster src={b.avatar_url} name={b.title} w={130} big /></motion.div>
            <div className="min-w-0 pb-1">
              <Display size={34} delay={0.7}>{b.title}</Display>
              <motion.p {...rise(0.9)} className="mt-1 text-[16px] text-white/80">Season {b.season} · {num(b.episodes)} episodes</motion.p>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <Display size={120} delay={1.2} color={RED} className="pb-[0.22em]">{days(b.days)}</Display>
            <Kicker delay={1.4}>start to finish. That's {num(Math.round(b.per_day * 10) / 10)} episodes a day.</Kicker>
          </div>
          {d.episode_day && (
            <motion.p {...rise(1.8)} className="rounded-xl bg-white/10 px-4 py-3 text-[14px]">
              Most in one day: <b>{num(d.episode_day.episodes)} episodes</b> of {d.episode_day.title} on {date(d.episode_day.date)}.
            </motion.p>
          )}
        </Card>
      );
    },
  },
  {
    id: "finished", label: "Finished vs dropped",
    when: (d) => d.progress.shows > 0,
    render: (d) => {
      const s = d.progress.summary;
      const rows: [string, number, string][] = [["Finished", s.finished, "#46d369"], ["Still watching", s.watching, RED], ["Dropped", s.dropped, "rgba(255,255,255,0.45)"]];
      return (
        <Card year={d.year}>
          <Kicker>You started</Kicker>
          <Display size={84} delay={0.3}><CountUp to={d.progress.shows} /> shows</Display>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {rows.map(([label, n, color], i) => (
              <motion.div key={label} {...rise(0.7 + i * 0.15)} className="rounded-xl bg-white/[0.07] px-3 py-3">
                <div style={{ ...heavy, fontSize: 38, color, lineHeight: 1 }}>{num(n)}</div>
                <div className="mt-1 text-[12px] font-medium text-white/75">{label}</div>
              </motion.div>
            ))}
          </div>
          {d.progress.finished.length > 0 && (
            <>
              <motion.p {...rise(1.3)} className="mt-7 text-[12px] font-bold uppercase tracking-[0.18em] text-white/60">Seen through to the end</motion.p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {d.progress.finished.slice(0, 8).map((f, i) => (
                  <motion.div key={f.key} {...pop(1.5 + i * 0.08)}><Poster src={f.avatar_url} name={f.title} w={70} /></motion.div>
                ))}
              </div>
            </>
          )}
        </Card>
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
        <Card year={d.year}>
          <Kicker>Shows or movies?</Kicker>
          <Display size={120} delay={0.3} color={RED}><CountUp to={Math.round((episode.est_s / total) * 100)} format={(n) => `${Math.round(n)}%`} /></Display>
          <Kicker delay={0.5}>of your watch time was shows</Kicker>
          <div className="mt-7 flex flex-col gap-3">
            {([["Episodes", episode.count, episode.est_s], ["Movies", movie.count, movie.est_s]] as [string, number, number][]).map(([label, n, t], i) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-[15px] font-bold"><span>{label} · {compact(n)}</span><span>{num(hrs(t))}h</span></div>
                <div className="h-3.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full rounded-full" style={{ background: i ? "#fff" : RED }} initial={{ width: 0 }}
                              animate={{ width: `${(t / total) * 100}%` }} transition={{ delay: 0.8 + i * 0.2, duration: 1 }} />
                </div>
              </div>
            ))}
          </div>
          {m && (
            <motion.div {...rise(1.5)} className="mt-auto flex items-center gap-4 rounded-xl bg-white/[0.07] p-3">
              <Poster src={m.thumb} name={m.title} w={60} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">{d.top_movies.length > 1 ? "A movie you watched" : "Your movie of the year"}</p>
                <p className="line-clamp-2 text-[18px] font-bold leading-tight">{m.title}</p>
              </div>
            </motion.div>
          )}
        </Card>
      );
    },
  },
  {
    id: "genres", label: "Top genres",
    when: (d) => d.top_genres.length > 0,
    render: (d) => (
      <Card year={d.year} glow="bottom">
        <Kicker>You couldn't get enough of</Kicker>
        <Display size={78} delay={0.3} color={RED}>{d.top_genres[0].title}</Display>
        <div className="mt-8 flex flex-col gap-2.5">
          {d.top_genres.slice(1, 5).map((g, i) => (
            <motion.div key={g.key} {...rise(0.8 + i * 0.15)} className="flex items-center gap-4 rounded-xl bg-white/[0.07] px-4 py-3">
              <span style={heavy} className="w-6 text-[24px] leading-none text-white/50">{i + 2}</span>
              <span className="text-[18px] font-bold">{g.title}</span>
            </motion.div>
          ))}
        </div>
      </Card>
    ),
  },
  {
    id: "clock", label: "Watch clock",
    when: (d) => d.has_times && d.clock.length > 0,
    render: (d) => (
      <Card year={d.year}>
        <Kicker>When you pressed play</Kicker>
        <Display size={52} delay={0.2}>Peak hour: {hourLabel(d.peak_hour ?? 0)}</Display>
        <div className="flex flex-1 items-center justify-center">
          <RadialClock data={d.clock.map((h) => h.count)} peak={d.peak_hour ?? 0} />
        </div>
      </Card>
    ),
  },
  {
    id: "biggest-day", label: "Biggest day",
    when: (d) => !!d.biggest_day,
    render: (d) => (
      <Card year={d.year}>
        <Kicker>Your biggest day was</Kicker>
        <Display size={58} delay={0.3}>{date(d.biggest_day!.date)}</Display>
        <div className="flex flex-1 flex-col justify-center">
          <Display size={150} delay={0.7} color={RED}><CountUp to={d.biggest_day!.count} /></Display>
          <Kicker delay={0.9}>titles in a single day</Kicker>
          {d.streak && d.streak.days > 1 && (
            <motion.p {...rise(1.4)} className="mt-10 rounded-xl bg-white/[0.07] px-4 py-3 text-[16px]">
              🔥 Longest streak: <b>{days(d.streak.days)}</b> in a row, {date(d.streak.start)} – {date(d.streak.end)}.
            </motion.p>
          )}
        </div>
      </Card>
    ),
  },
  {
    id: "discovery", label: "New show",
    when: (d) => !!d.discovery,
    render: (d) => {
      const s = d.discovery!;
      return (
        <Card year={d.year} glow="center">
          <Kicker>New to you this year</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.5)}><Poster src={s.avatar_url} name={s.title} w={170} big /></motion.div>
            <Display size={42} delay={1} className="mt-6">{s.title}</Display>
            <motion.p {...rise(1.3)} className="mt-2 text-[16px] text-white/80">
              First episode {date(s.first_watched)}, then {num(s.count)} in total.
            </motion.p>
          </div>
        </Card>
      );
    },
  },
  {
    id: "personality", label: "Personality",
    render: (d) => {
      const p = d.personality;
      return (
        <Card year={d.year} glow="none">
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse 110% 70% at 50% 40%, ${p.color ?? RED}cc, transparent 72%)` }} />
          <div className="relative flex flex-1 flex-col">
            <Kicker>Your viewer personality is</Kicker>
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
                          transition={{ delay: 0.5, type: "spring", stiffness: 110, damping: 10 }} className="text-[110px] leading-none">
                {p.emoji}
              </motion.div>
              <Display size={60} delay={1.1} className="mt-5">{p.name}</Display>
              {p.tagline && <motion.p {...rise(1.4)} className="mt-2 text-[17px] italic text-white/90">“{p.tagline}”</motion.p>}
              <motion.p {...rise(1.8)} className="mt-8 rounded-xl bg-black/40 px-4 py-3 text-[15px]">{p.reason}</motion.p>
              {p.also.length > 0 && (
                <motion.p {...rise(2.2)} className="mt-4 text-[13px] text-white/70">
                  Also a bit of: {p.also.map((a) => `${a.emoji} ${a.name.replace(/^The /, "")}`).join(" · ")}
                </motion.p>
              )}
            </div>
          </div>
        </Card>
      );
    },
  },
  { id: "summary", label: "Summary", render: (d) => <NetflixSummary d={d} /> },
];

function NetflixSummary({ d }: { d: NetflixWrappedData }) {
  const p = d.personality;
  const s = d.progress.summary;
  return (
    <Card footer={false}>
      <div className="-mt-4 flex items-center justify-between">
        <span className="flex items-center gap-2"><NMark size={26} />
          <span className="text-[20px] font-extrabold tracking-tight">Netflix Wrapped</span>
        </span>
        <span style={heavy} className="text-[32px] leading-none">{d.year}</span>
      </div>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Top shows</p>
      <div className="mt-2 flex gap-1.5">
        {d.top_channels.slice(0, 5).map((c, i) => (
          <div key={c.key} className="relative min-w-0 flex-1">
            <Poster src={c.avatar_url} name={c.title} w={58} />
            <span className="absolute -bottom-1 left-1"><Rank n={i + 1} size={34} /></span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Hours watched" value={num(hrs(d.overview.est_s))} sub={d.has_times ? undefined : "estimated"} />
        <Stat label="Titles" value={compact(d.overview.videos)} sub={`${num(d.progress.shows)} shows · ${num(d.kind_split.movie.count)} movies`} />
        <Stat label="Shows finished" value={num(s.finished)} sub={`${num(s.dropped)} dropped`} />
        <Stat label="Fastest season" value={d.binge ? days(d.binge.days) : "–"} sub={d.binge ? `${d.binge.title}` : undefined} />
      </div>
      {d.top_genres[0] && (
        <div className="mt-2 rounded-xl bg-white/[0.07] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/60">Top genres</p>
          <p className="truncate text-[15px] font-bold">{d.top_genres.slice(0, 3).map((g) => g.title).join(" · ")}</p>
        </div>
      )}
      <div className="mt-auto flex items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: RED }}>
        <span className="text-[38px] leading-none">{p.emoji}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/80">Viewer personality</p>
          <p style={heavy} className="text-[21px] leading-tight">{p.name}</p>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.07] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/60">{label}</p>
      <p style={heavy} className="truncate text-[25px] leading-none">{value}</p>
      {sub && <p className="truncate text-[10px] text-white/60">{sub}</p>}
    </div>
  );
}
