/* Wrapped story cards. Every card is laid out at a fixed 360 x 640 design size
   (scaled to the screen by the player, exported at 3x = 1080 x 1920). */
import { ReactNode, useEffect, useState } from "react";
import { MotionGlobalConfig, motion } from "framer-motion";
import { clockTime, compact, date, hourLabel, num } from "../format";
import { WrappedData, img, thumbOf } from "./types";

export const CARD_W = 360;
export const CARD_H = 640;

export interface CardDef {
  id: string;
  label: string;
  render: (d: WrappedData) => ReactNode;
}

// ------------------------------------------------------------------ building blocks

function Card({ bg, children, footer = true, year }: { bg: string; children: ReactNode; footer?: boolean; year?: number }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden text-white" style={{ background: bg, fontFamily: "Roboto, system-ui, sans-serif" }}>
      <Blobs />
      <div className="relative z-10 flex flex-1 flex-col px-7 pb-6 pt-16">{children}</div>
      {footer && (
        <div className="relative z-10 flex items-center justify-between px-7 pb-6 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
          <span className="flex items-center gap-1.5"><YtMark size={16} /> YouTube Wrapped</span>
          {year && <span>{year}</span>}
        </div>
      )}
    </div>
  );
}

function Blobs() {
  return (
    <>
      <motion.div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl"
                  animate={{ scale: [1, 1.15, 1], x: [0, -20, 0] }} transition={{ duration: 8, repeat: Infinity }} />
      <motion.div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-black/25 blur-2xl"
                  animate={{ scale: [1, 1.1, 1], y: [0, -16, 0] }} transition={{ duration: 9, repeat: Infinity }} />
    </>
  );
}

export function YtMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect x="2" y="7" width="28" height="18" rx="6" fill="#fff" />
      <path d="M13 11.5v9l8-4.5z" fill="#ff0033" />
    </svg>
  );
}

const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
});
const pop = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  transition: { delay, type: "spring", stiffness: 160, damping: 14 },
});

function Kicker({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return <motion.p {...rise(delay)} className="text-[19px] font-medium leading-snug text-white/85">{children}</motion.p>;
}

function Big({ children, delay = 0.2, size = 64 }: { children: ReactNode; delay?: number; size?: number }) {
  return (
    <motion.div {...rise(delay)} className="font-black leading-[0.95] tracking-tight" style={{ fontSize: size }}>
      {children}
    </motion.div>
  );
}

function CountUp({ to, duration = 1.6, format = num }: { to: number; duration?: number; format?: (n: number) => string }) {
  const [v, setV] = useState(MotionGlobalConfig.skipAnimations ? to : 0);
  useEffect(() => {
    if (MotionGlobalConfig.skipAnimations) return setV(to);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / (duration * 1000));
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{format(v)}</>;
}

function Avatar({ src, name, size }: { src?: string | null; name?: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  const url = img(src);
  if (!url || failed)
    return (
      <div className="flex shrink-0 items-center justify-center rounded-full bg-white/20 font-black" style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {(name ?? "?").charAt(0).toUpperCase()}
      </div>
    );
  return <img src={url} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
}

const hrs = (s: number) => Math.round(s / 3600);
const title = (t?: string | null) => (t && !t.startsWith("http") ? t : "An unavailable video");

// ------------------------------------------------------------------ cards

const G = {
  red: "linear-gradient(160deg,#ff0033 0%,#b3002a 55%,#4a0012 100%)",
  night: "linear-gradient(170deg,#1b1145 0%,#3b1c8c 50%,#ff0033 130%)",
  sunset: "linear-gradient(165deg,#ff6a00 0%,#ff0033 60%,#7a0019 100%)",
  teal: "linear-gradient(165deg,#00b894 0%,#00695c 60%,#04332c 100%)",
  pink: "linear-gradient(165deg,#ff4fa3 0%,#c2185b 55%,#3d0820 100%)",
  blue: "linear-gradient(165deg,#3a86ff 0%,#1d3fa8 60%,#0a1640 100%)",
  gold: "linear-gradient(165deg,#ffb703 0%,#fb8500 55%,#7a2e00 100%)",
  dark: "linear-gradient(170deg,#202020 0%,#0f0f0f 60%,#3a0010 130%)",
};

export const CARDS: CardDef[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <Card bg={G.red} footer={false}>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div {...pop(0.1)}><YtMark size={88} /></motion.div>
          <motion.div {...rise(0.4)} className="mt-6 text-[120px] font-black leading-none tracking-tighter">{d.year}</motion.div>
          <motion.p {...rise(0.7)} className="mt-3 text-[22px] font-bold">Your year on YouTube</motion.p>
          <motion.p {...rise(1.1)} className="mt-10 text-sm text-white/70">Tap to start ▸</motion.p>
        </div>
      </Card>
    ),
  },
  {
    id: "time", label: "Watch time",
    render: (d) => {
      const days = d.overview.est_s / 86400;
      return (
        <Card bg={G.sunset} year={d.year}>
          <Kicker>In {d.year} you watched about</Kicker>
          <Big size={92} delay={0.3}><CountUp to={hrs(d.overview.est_s)} /></Big>
          <Big size={40} delay={0.4}>hours of YouTube</Big>
          <motion.div {...rise(1.2)} className="mt-8 space-y-3 text-[17px]">
            <p>That's <b>{days >= 1 ? `${days.toFixed(1)} full days` : `${Math.round(d.overview.est_s / 60)} minutes`}</b>.</p>
            <p>Across <b>{num(d.overview.videos)} videos</b> from <b>{num(d.overview.unique_channels)} channels</b>.</p>
            <p>You showed up on <b>{num(d.overview.active_days)} of {d.overview.days} days</b>.</p>
          </motion.div>
          <motion.p {...rise(1.8)} className="mt-auto text-[11px] text-white/60">
            Estimated from when each video started. Sleep/background audio not included.
          </motion.p>
        </Card>
      );
    },
  },
  {
    id: "top-channel", label: "Top channel",
    render: (d) => {
      const c = d.top_channels[0];
      return (
        <Card bg={G.dark} year={d.year}>
          <Kicker>Your #1 channel of {d.year} was…</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, scale: 0.2, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        transition={{ delay: 0.9, type: "spring", stiffness: 120, damping: 12 }}
                        className="rounded-full p-1.5" style={{ background: "linear-gradient(135deg,#ff0033,#ff9f1c)" }}>
              <Avatar src={c?.avatar_url} name={c?.title} size={190} />
            </motion.div>
            <motion.div {...rise(1.5)} className="mt-6 text-[36px] font-black leading-tight">{c?.title}</motion.div>
            <motion.div {...rise(1.8)} className="mt-2 text-[17px] text-white/80">{num(c?.count ?? 0)} videos</motion.div>
            <motion.div {...rise(2.1)} className="mt-1 text-[12px] text-white/50">not counting Shorts</motion.div>
          </div>
        </Card>
      );
    },
  },
  {
    id: "top-5", label: "Top 5 channels",
    render: (d) => (
      <Card bg={G.pink} year={d.year}>
        <Kicker>Your top channels <span className="text-white/60">(long-form)</span></Kicker>
        <div className="mt-6 flex flex-col gap-4">
          {d.top_channels.slice(0, 5).map((c, i) => (
            <motion.div key={c.key} {...rise(0.3 + i * 0.18)} className="flex items-center gap-4">
              <span className="w-7 text-[30px] font-black">{i + 1}</span>
              <Avatar src={c.avatar_url} name={c.title} size={60} />
              <div className="min-w-0">
                <div className="truncate text-[19px] font-bold">{c.title}</div>
                <div className="text-sm text-white/75">{num(c.count)} videos</div>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    ),
  },
  {
    id: "top-video", label: "Top video",
    render: (d) => {
      const v = d.top_videos[0];
      if (!v) return null;
      return (
        <Card bg={G.blue} year={d.year}>
          <Kicker>The video you kept coming back to</Kicker>
          <motion.img {...pop(0.4)} src={thumbOf(v.key, v.thumb)} alt=""
                      className="mt-8 aspect-video w-full rounded-2xl object-cover shadow-2xl" />
          <motion.div {...rise(0.9)} className="mt-5 line-clamp-3 text-[22px] font-black leading-tight">{title(v.title)}</motion.div>
          <motion.div {...rise(1.1)} className="mt-1 text-[15px] text-white/75">{v.channel}</motion.div>
          <Big size={56} delay={1.4}><span className="mt-6 block">{v.count}×</span></Big>
          <Kicker delay={1.6}>times you watched it</Kicker>
        </Card>
      );
    },
  },
  {
    id: "category", label: "Top category",
    render: (d) => {
      const cat = d.top_categories[0];
      const genres = d.top_genres.slice(0, 3);
      return (
        <Card bg={G.teal} year={d.year}>
          <Kicker>You were all about</Kicker>
          <Big size={58} delay={0.3}>{cat?.title ?? "Everything"}</Big>
          {cat && <Kicker delay={0.6}>{Math.round(cat.share * 100)}% of your videos</Kicker>}
          <motion.p {...rise(1)} className="mt-10 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Top genres</motion.p>
          <div className="mt-3 flex flex-col gap-3">
            {genres.map((g, i) => (
              <motion.div key={g.key} {...rise(1.2 + i * 0.2)} className="flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-3">
                <span className="text-[22px] font-black">{i + 1}</span>
                <span className="text-[18px] font-bold">{g.title}</span>
              </motion.div>
            ))}
          </div>
        </Card>
      );
    },
  },
  {
    id: "shorts", label: "Shorts",
    render: (d) => {
      const s = d.overview.split;
      const total = s.long.videos + s.short.videos + s.music.videos || 1;
      const sp = Math.round((s.short.videos / total) * 100);
      return (
        <Card bg={G.red} year={d.year}>
          <Kicker>Shorts or long-form?</Kicker>
          <Big size={110} delay={0.3}><CountUp to={sp} format={(n) => `${Math.round(n)}%`} /></Big>
          <Kicker delay={0.5}>of your videos were Shorts</Kicker>
          <div className="mt-10 flex flex-col gap-3">
            {([["Shorts", s.short.videos], ["Long-form", s.long.videos], ...(s.music.videos ? [["Music", s.music.videos]] : [])] as [string, number][]).map(([label, n], i) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-[15px] font-bold"><span>{label}</span><span>{compact(n)}</span></div>
                <div className="h-4 overflow-hidden rounded-full bg-black/25">
                  <motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }}
                              animate={{ width: `${(n / total) * 100}%` }} transition={{ delay: 0.8 + i * 0.2, duration: 1 }} />
                </div>
              </div>
            ))}
          </div>
          <motion.p {...rise(1.6)} className="mt-auto text-[11px] text-white/60">Shorts are detected from vertical videos up to 3 minutes, so this is approximate.</motion.p>
        </Card>
      );
    },
  },
  {
    id: "shorts-channels", label: "Top Shorts channels",
    render: (d) => {
      const [first, ...rest] = d.top_shorts_channels;
      if (!first) return null;
      return (
        <Card bg={G.night} year={d.year}>
          <Kicker>Your Shorts rabbit hole</Kicker>
          <div className="mt-8 flex flex-col items-center text-center">
            <motion.div {...pop(0.4)} className="rounded-full p-1.5" style={{ background: "linear-gradient(135deg,#ff0033,#7c5cff)" }}>
              <Avatar src={first.avatar_url} name={first.title} size={130} />
            </motion.div>
            <motion.div {...rise(0.9)} className="mt-4 text-[30px] font-black leading-tight">{first.title}</motion.div>
            <motion.div {...rise(1.1)} className="text-[16px] text-white/80">{num(first.count)} Shorts</motion.div>
          </div>
          <div className="mt-8 flex flex-col gap-3">
            {rest.slice(0, 3).map((c, i) => (
              <motion.div key={c.key} {...rise(1.4 + i * 0.15)} className="flex items-center gap-3">
                <span className="w-5 text-[20px] font-black">{i + 2}</span>
                <Avatar src={c.avatar_url} name={c.title} size={40} />
                <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{c.title}</span>
                <span className="text-sm text-white/70">{num(c.count)}</span>
              </motion.div>
            ))}
          </div>
        </Card>
      );
    },
  },
  {
    id: "clock", label: "Watch clock",
    render: (d) => (
      <Card bg={G.night} year={d.year}>
        <Kicker>Your watch clock</Kicker>
        <Big size={40} delay={0.2}>Peak hour: {hourLabel(d.peak_hour)}</Big>
        <div className="flex flex-1 items-center justify-center">
          <RadialClock data={d.clock.map((h) => h.count)} peak={d.peak_hour} />
        </div>
      </Card>
    ),
  },
  {
    id: "biggest-day", label: "Biggest day",
    render: (d) => d.biggest_day && (
      <Card bg={G.gold} year={d.year}>
        <Kicker>Your biggest day was</Kicker>
        <Big size={46} delay={0.3}>{date(d.biggest_day.date)}</Big>
        <div className="flex flex-1 flex-col justify-center">
          <Big size={120} delay={0.7}><CountUp to={d.biggest_day.count} /></Big>
          <Kicker delay={0.9}>videos in a single day</Kicker>
          {d.longest_session && (
            <motion.p {...rise(1.4)} className="mt-8 text-[16px]">
              Longest binge: <b>{Math.round(d.longest_session.time_s / 60)} minutes</b> straight, {num(d.longest_session.videos)} videos.
            </motion.p>
          )}
        </div>
      </Card>
    ),
  },
  {
    id: "streak", label: "Streak",
    render: (d) => d.streak && (
      <Card bg={G.sunset} year={d.year}>
        <Kicker>Your longest streak</Kicker>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div {...pop(0.3)} className="text-[90px] leading-none">🔥</motion.div>
          <Big size={130} delay={0.6}><CountUp to={d.streak.days} /></Big>
          <Kicker delay={0.8}>days in a row</Kicker>
          <motion.p {...rise(1.2)} className="mt-4 text-[15px] text-white/80">{date(d.streak.start)} – {date(d.streak.end)}</motion.p>
        </div>
      </Card>
    ),
  },
  {
    id: "night", label: "Latest night",
    render: (d) => d.latest_night && (
      <Card bg={G.night} year={d.year}>
        <Kicker>Your latest night</Kicker>
        <Big size={66} delay={0.3}><span className="whitespace-nowrap">{clockTime(d.latest_night.local_iso)}</span></Big>
        <Kicker delay={0.5}>{date(d.latest_night.local_iso)}. Go to sleep. 🌙</Kicker>
        <motion.div {...rise(1)} className="mt-auto rounded-2xl bg-white/10 p-3">
          {d.latest_night.video_id && <img src={thumbOf(d.latest_night.video_id, d.latest_night.thumb)} alt="" className="aspect-video w-full rounded-xl object-cover" />}
          <div className="mt-3 line-clamp-2 text-[16px] font-bold">{title(d.latest_night.title)}</div>
          <div className="text-sm text-white/70">{d.latest_night.channel}</div>
        </motion.div>
      </Card>
    ),
  },
  {
    id: "discovery", label: "Discovery",
    render: (d) => d.discovery && (
      <Card bg={G.teal} year={d.year}>
        <Kicker>Your discovery of the year</Kicker>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div {...pop(0.5)} className="rounded-full bg-white/20 p-2"><Avatar src={d.discovery.avatar_url} name={d.discovery.title} size={170} /></motion.div>
          <motion.div {...rise(1)} className="mt-6 text-[34px] font-black leading-tight">{d.discovery.title}</motion.div>
          <motion.p {...rise(1.3)} className="mt-2 text-[16px] text-white/85">
            First watched {date(d.discovery.first_watched)}, then {num(d.discovery.count)} videos.
          </motion.p>
        </div>
      </Card>
    ),
  },
  {
    id: "personality", label: "Personality",
    render: (d) => {
      const p = d.personality;
      const c = p.color ?? "#ff0033";
      return (
        <Card bg={`linear-gradient(165deg, ${c} 0%, #0f0f0f 115%)`} year={d.year}>
          <Kicker>Your viewer personality is</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
                        transition={{ delay: 0.5, type: "spring", stiffness: 110, damping: 10 }} className="text-[120px] leading-none">
              {p.emoji}
            </motion.div>
            <motion.div {...rise(1.1)} className="mt-5 text-[40px] font-black leading-tight">{p.name}</motion.div>
            {p.tagline && <motion.p {...rise(1.4)} className="mt-2 text-[18px] italic text-white/90">“{p.tagline}”</motion.p>}
            <motion.p {...rise(1.8)} className="mt-8 rounded-2xl bg-black/25 px-4 py-3 text-[15px]">{p.reason}</motion.p>
            {p.also.length > 0 && (
              <motion.p {...rise(2.2)} className="mt-4 text-[13px] text-white/70">
                Also a bit of: {p.also.map((a) => `${a.emoji} ${a.name.replace(/^The /, "")}`).join(" · ")}
              </motion.p>
            )}
          </div>
        </Card>
      );
    },
  },
  { id: "summary", label: "Summary", render: (d) => <SummaryCard d={d} /> },
];

export function SummaryCard({ d }: { d: WrappedData }) {
  const p = d.personality;
  return (
    <Card bg={G.red} footer={false}>
      <div className="-mt-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[15px] font-black"><YtMark size={24} /> YouTube Wrapped</span>
        <span className="text-[34px] font-black leading-none">{d.year}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/70">Top channels</p>
          <p className="text-[9px] text-white/50">not counting Shorts</p>
          <ol className="mt-2 space-y-1.5">
            {d.top_channels.slice(0, 5).map((c, i) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className="w-3 text-[13px] font-black">{i + 1}</span>
                <Avatar src={c.avatar_url} name={c.title} size={28} />
                <span className="truncate text-[13px] font-bold">{c.title}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/70">Top genres</p>
          <ol className="mt-2 space-y-1.5">
            {d.top_genres.slice(0, 5).map((g, i) => (
              <li key={g.key} className="flex h-7 items-center gap-2">
                <span className="w-3 text-[13px] font-black">{i + 1}</span>
                <span className="truncate text-[13px] font-bold">{g.title}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {d.top_videos[0] && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/20 p-2.5">
          <img src={thumbOf(d.top_videos[0].key, d.top_videos[0].thumb)} alt="" className="h-[54px] w-24 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/70">Most rewatched · {d.top_videos[0].count}×</p>
            <p className="line-clamp-2 text-[13px] font-bold leading-tight">{title(d.top_videos[0].title)}</p>
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Stat label="Hours watched" value={num(hrs(d.overview.est_s))} sub="estimated" />
        <Stat label="Videos" value={compact(d.overview.videos)} sub={`${num(d.overview.unique_channels)} channels`} />
        <Stat label="Longest streak" value={d.streak ? `${d.streak.days} days` : "–"} />
        <Stat label="Top Shorts" value={d.top_shorts_channels[0]?.title ?? "–"} small />
      </div>
      <div className="mt-auto flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 text-[#0f0f0f]">
        <span className="text-[38px] leading-none">{p.emoji}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#606060]">Viewer personality</p>
          <p className="truncate text-[20px] font-black leading-tight">{p.name}</p>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, small = false }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/20 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/70">{label}</p>
      <p className={`truncate font-black leading-tight ${small ? "pt-1 text-[16px]" : "text-[24px]"}`}>{value}</p>
      {sub && <p className="text-[10px] text-white/60">{sub}</p>}
    </div>
  );
}

/** Hand-drawn radial clock (plain SVG, so it exports cleanly). Midnight at the top. */
function RadialClock({ data, peak }: { data: number[]; peak: number }) {
  const max = Math.max(1, ...data);
  const size = 280, c = size / 2, inner = 46, outer = 128;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Watch clock">
      {data.map((v, h) => {
        const a0 = ((h / 24) * 360 - 90 + 1.5) * (Math.PI / 180);
        const a1 = (((h + 1) / 24) * 360 - 90 - 1.5) * (Math.PI / 180);
        const r = inner + (outer - inner) * (v / max);
        const p = (rad: number, a: number) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
        const d = `M${p(inner, a0)} L${p(r, a0)} A${r},${r} 0 0 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 0 0 ${p(inner, a0)}Z`;
        return (
          <motion.path key={h} d={d} fill={h === peak ? "#ffffff" : "rgba(255,255,255,0.55)"}
                       initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + h * 0.04 }} />
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
        return (
          <text key={h} x={c + 32 * Math.cos(a)} y={c + 32 * Math.sin(a) + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(255,255,255,0.8)">
            {hourLabel(h)}
          </text>
        );
      })}
    </svg>
  );
}
