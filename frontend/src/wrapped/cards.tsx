/* YouTube's Wrapped story cards, in the shared look. Every card is laid out at a fixed 360 x 640 design size
   (scaled to the screen by the player, saved at 3x = 1080 x 1920). The parts live in ./kit. */
import { ReactNode, useEffect, useState } from "react";
import { MotionGlobalConfig, motion } from "framer-motion";
import { clockTime, compact, date, hourLabel, num } from "../format";
import { OV } from "../overview/kit";
import { WrappedData, thumbOf } from "./types";
import { platformVerb } from "../platform";
import { Badge, Big, Face, fit, GrowBar, Kicker, Label, StatBox, Sticker, StreakStrip, Thumb, WCard, Wordmark, pop, rise, useTone } from "./kit";

export { pop, rise };

/** "viewer" or "listener", from the platform's verb (outside React: cards are plain render functions). */
const who = () => (platformVerb() === "listen" ? "listener" : platformVerb() === "play" ? "player" : "viewer");

export const CARD_W = 360;
export const CARD_H = 640;

export interface CardDef<T = WrappedData> {
  id: string;
  label: string;
  render: (d: T) => ReactNode;
  /** shown only when this returns true (default: always) */
  when?: (d: T) => boolean;
}

/** The old-layout pages still use a small play mark for YouTube's tab (not on any Wrapped card). */
export function YtMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect x="2" y="7" width="28" height="18" rx="6" fill="#fff" />
      <path d="M13 11.5v9l8-4.5z" fill="#ff0033" />
    </svg>
  );
}

export function CountUp({ to, duration = 1.6, format = num }: { to: number; duration?: number; format?: (n: number) => string }) {
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

const hrs = (s: number) => Math.round(s / 3600);
export const MODE_LABEL: Record<WrappedData["mode"], string> = { all: "", videos: "Videos only", shorts: "Shorts only" };
/** Footer tag: "2024", or "2024 · Shorts only" so a filtered card can't pass for the full year. */
const tag = (d: WrappedData) => (d.mode === "all" ? String(d.year) : `${d.year} · ${MODE_LABEL[d.mode]}`);
const unit = (d: WrappedData) => (d.mode === "shorts" ? "Shorts" : "videos");
const what = (d: WrappedData) => (d.mode === "shorts" ? "Shorts" : d.mode === "videos" ? "videos" : "YouTube");
const title = (t?: string | null) => (t && !t.startsWith("http") ? t : "An unavailable video");

// ------------------------------------------------------------------ cards

export const CARDS: CardDef[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <WCard tone="ink" footer={false} ring="bl">
        <div className="flex flex-1 flex-col justify-center">
          <motion.div {...pop(0.1)}><Wordmark size={22} /></motion.div>
          <Big size={116} delay={0.4} hi className="mt-5 whitespace-nowrap">{d.year}</Big>
          <motion.p {...rise(0.7)} className="mt-4 font-ov-display text-[28px] font-extrabold leading-tight">
            {d.mode === "shorts" ? "Your year in Shorts." : d.mode === "videos" ? "Your year in videos." : "Your year on YouTube."}
          </motion.p>
          {d.mode !== "all" && <Label delay={0.9} className="mt-2">{MODE_LABEL[d.mode]}</Label>}
          <motion.p {...rise(1.1)} className="mt-12 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Tap to start ›</motion.p>
        </div>
      </WCard>
    ),
  },
  {
    id: "time", label: "Watch time",
    render: (d) => {
      const days = d.overview.est_s / 86400;
      return (
        <WCard tone="cream" tag={tag(d)}>
          <Kicker>In {d.year} you watched about</Kicker>
          <Big size={104} delay={0.3} hi><CountUp to={hrs(d.overview.est_s)} /></Big>
          <Big size={36} delay={0.4}>hours of {what(d)}</Big>
          <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
            <p>That's <b>{days >= 1 ? `${days.toFixed(1)} full days` : `${Math.round(d.overview.est_s / 60)} minutes`}</b>.</p>
            <p>Across <b>{num(d.overview.videos)} videos</b> from <b>{num(d.overview.unique_channels)} channels</b>.</p>
            <p>You showed up on <b>{num(d.overview.active_days)} of {d.overview.days} days</b>.</p>
          </motion.div>
          <Label delay={1.7} className="mt-auto normal-case tracking-normal">Estimated from when each video started. Sleep / background audio not included.</Label>
        </WCard>
      );
    },
  },
  {
    id: "top-channel", label: "Top channel",
    render: (d) => {
      const c = d.top_channels[0];
      return (
        <WCard tone="mustard" tag={tag(d)}>
          <Kicker>Your #1 channel of {d.year} was…</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, scale: 0.3, rotate: -16 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        transition={{ delay: 0.8, type: "spring", stiffness: 120, damping: 12 }} className="relative">
              <Face src={c?.avatar_url} name={c?.title} size={196} />
              <Sticker size={66} delay={1.4}>#1</Sticker>
            </motion.div>
            <Big size={fit(c?.title, 38)} delay={1.5} className="mt-6">{c?.title}</Big>
            <motion.div {...rise(1.8)} className="mt-2 font-shelf-mono text-[14px]">{num(c?.count ?? 0)} {unit(d)}{d.mode === "all" ? " · not counting Shorts" : ""}</motion.div>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "top-5", label: "Top 5 channels",
    render: (d) => (
      <WCard tone="paper" tag={tag(d)}>
        <Big size={40} delay={0}>Your top {d.mode === "shorts" ? "Shorts " : ""}channels</Big>
        {d.mode === "all" && <Label delay={0.1} className="mt-2">Long videos</Label>}
        <ol className="mt-6 flex flex-col gap-3.5">
          {d.top_channels.slice(0, 5).map((c, i) => (
            <motion.li key={c.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <Face src={c.avatar_url} name={c.title} size={56} />
              <div className="min-w-0">
                <div className="truncate text-[18px] font-bold">{c.title}</div>
                <div className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{num(c.count)} {unit(d)}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "top-video", label: "Top video",
    render: (d) => {
      const v = d.top_videos[0];
      if (!v) return null;
      return (
        <WCard tone="ink" tag={tag(d)}>
          <Kicker>The video you kept coming back to</Kicker>
          <motion.div {...pop(0.4)} className="mt-7"><Thumb src={thumbOf(v.key, v.thumb)} /></motion.div>
          <motion.div {...rise(0.9)} className="mt-5 line-clamp-3 font-ov-display text-[24px] font-extrabold leading-tight">{title(v.title)}</motion.div>
          <motion.div {...rise(1.1)} className="mt-1 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{v.channel}</motion.div>
          <div className="mt-auto flex items-baseline gap-3">
            <Big size={86} delay={1.4} hi>{v.count}×</Big>
            <Kicker delay={1.6}>times you watched it</Kicker>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "category", label: "Top category",
    render: (d) => {
      const cat = d.top_categories[0];
      const genres = d.top_genres.slice(0, 3);
      return (
        <WCard tone="teal" tag={tag(d)}>
          <Kicker>You were all about</Kicker>
          <Big size={fit(cat?.title ?? "Everything", 56)} delay={0.3} hi className="mt-1">{cat?.title ?? "Everything"}</Big>
          {cat && <Kicker delay={0.6}>{Math.round(cat.share * 100)}% of your videos</Kicker>}
          <Label delay={1} className="mt-10">Top genres</Label>
          <ol className="mt-3 flex flex-col gap-2.5">
            {genres.map((g, i) => (
              <motion.li key={g.key} {...rise(1.2 + i * 0.18)} className="flex items-center gap-3 rounded-xl border-2 px-4 py-3"
                         style={{ borderColor: OV.paper, background: "rgba(251,246,236,0.12)" }}>
                <span className="font-ov-display text-[22px] font-extrabold" style={{ color: OV.mustard }}>{i + 1}</span>
                <span className="text-[18px] font-bold">{g.title}</span>
              </motion.li>
            ))}
          </ol>
        </WCard>
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
        <WCard tone="cream" tag={tag(d)}>
          <Kicker>Shorts or long videos?</Kicker>
          <Big size={112} delay={0.3} hi><CountUp to={sp} format={(n) => `${Math.round(n)}%`} /></Big>
          <Kicker delay={0.5}>of your videos were Shorts</Kicker>
          <div className="mt-9 flex flex-col gap-4">
            {([["Shorts", s.short.videos], ["Long videos", s.long.videos], ...(s.music.videos ? [["Music", s.music.videos]] : [])] as [string, number][]).map(([label, n], i) => (
              <GrowBar key={label} label={label} value={compact(n)} share={n / total} delay={0.8 + i * 0.2} color={[OV.accent, OV.ink, OV.teal][i]} />
            ))}
          </div>
          <Label delay={1.6} className="mt-auto normal-case tracking-normal">Shorts are spotted from vertical videos up to 3 minutes, so this is close, not exact.</Label>
        </WCard>
      );
    },
  },
  {
    id: "shorts-channels", label: "Top Shorts channels",
    render: (d) => {
      const [first, ...rest] = d.top_shorts_channels;
      if (!first) return null;
      return (
        <WCard tone="ink" tag={tag(d)}>
          <Kicker>Your Shorts rabbit hole</Kicker>
          <div className="mt-7 flex flex-col items-center text-center">
            <motion.div {...pop(0.4)} className="relative"><Face src={first.avatar_url} name={first.title} size={132} /><Sticker size={50} delay={0.9}>#1</Sticker></motion.div>
            <Big size={fit(first.title, 30, 22)} delay={0.9} className="mt-4">{first.title}</Big>
            <motion.div {...rise(1.1)} className="mt-1 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{num(first.count)} Shorts</motion.div>
          </div>
          <ol className="mt-7 flex flex-col gap-3">
            {rest.slice(0, 3).map((c, i) => (
              <motion.li key={c.key} {...rise(1.4 + i * 0.15)} className="flex items-center gap-3">
                <span className="w-5 font-ov-display text-[20px] font-extrabold" style={{ color: OV.mustard }}>{i + 2}</span>
                <Face src={c.avatar_url} name={c.title} size={40} />
                <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{c.title}</span>
                <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{num(c.count)}</span>
              </motion.li>
            ))}
          </ol>
        </WCard>
      );
    },
  },
  {
    id: "clock", label: "Watch clock",
    render: (d) => (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>Your watch clock</Kicker>
        <Big size={36} delay={0.2}>Peak hour: <span style={{ color: OV.mustard }}>{hourLabel(d.peak_hour)}</span></Big>
        <div className="flex flex-1 items-center justify-center">
          <RadialClock data={d.clock.map((h) => h.count)} peak={d.peak_hour} />
        </div>
      </WCard>
    ),
  },
  {
    id: "biggest-day", label: "Biggest day",
    render: (d) => d.biggest_day && (
      <WCard tone="mustard" tag={tag(d)}>
        <Kicker>Your biggest day was</Kicker>
        <Big size={44} delay={0.3}>{date(d.biggest_day.date)}</Big>
        <div className="flex flex-1 flex-col justify-center">
          <Big size={140} delay={0.7}><CountUp to={d.biggest_day.count} /></Big>
          <Kicker delay={0.9}>videos in a single day</Kicker>
          {d.longest_session && (
            <motion.p {...rise(1.4)} className="mt-8 rounded-xl border-2 px-4 py-3 text-[16px]" style={{ borderColor: OV.ink, background: "rgba(251,246,236,0.45)" }}>
              Longest sitting: <b>{Math.round(d.longest_session.time_s / 60)} minutes</b> straight, {num(d.longest_session.videos)} videos.
            </motion.p>
          )}
        </div>
      </WCard>
    ),
  },
  {
    id: "streak", label: "Streak",
    render: (d) => d.streak && (
      <WCard tone="teal" tag={tag(d)}>
        <Kicker>Your longest streak</Kicker>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <Big size={150} delay={0.4} hi><CountUp to={d.streak.days} /></Big>
          <Big size={34} delay={0.6}>days in a row</Big>
          <Label delay={0.8} className="mb-6">{date(d.streak.start)} – {date(d.streak.end)}</Label>
          <StreakStrip days={d.streak.days} delay={1} />
        </div>
      </WCard>
    ),
  },
  {
    id: "night", label: "Latest night",
    render: (d) => d.latest_night && (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>Your latest night</Kicker>
        <Big size={78} delay={0.3} hi><span className="whitespace-nowrap">{clockTime(d.latest_night.local_iso)}</span></Big>
        <Kicker delay={0.5}>{date(d.latest_night.local_iso)}. Time for bed.</Kicker>
        <motion.div {...rise(1)} className="mt-auto">
          {d.latest_night.video_id && <Thumb src={thumbOf(d.latest_night.video_id, d.latest_night.thumb)} />}
          <div className="mt-3 line-clamp-2 text-[16px] font-bold">{title(d.latest_night.title)}</div>
          <div className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{d.latest_night.channel}</div>
        </motion.div>
      </WCard>
    ),
  },
  {
    id: "discovery", label: "Discovery",
    render: (d) => d.discovery && (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>Your discovery of the year</Kicker>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div {...pop(0.5)} className="relative">
            <Face src={d.discovery.avatar_url} name={d.discovery.title} size={176} />
            <Sticker size={60} delay={1}>New</Sticker>
          </motion.div>
          <Big size={fit(d.discovery.title, 36)} delay={1} className="mt-6">{d.discovery.title}</Big>
          <motion.p {...rise(1.3)} className="mt-2 text-[16px]" style={{ color: OV.soft }}>
            First watched {date(d.discovery.first_watched)}, then {num(d.discovery.count)} videos.
          </motion.p>
        </div>
      </WCard>
    ),
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={tag(d)} /> },
  { id: "summary", label: "Summary", render: (d) => <SummaryCard d={d} /> },
];

/** The viewer personality: shared by every platform's story. */
export function Personality({ d, tagText }: { d: { personality: WrappedData["personality"] }; tagText: string }) {
  const p = d.personality;
  return (
    <WCard tone="teal" tag={tagText}>
      <Kicker>Your {who()} personality is</Kicker>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Badge size={150}>{p.emoji}</Badge>
        <Big size={fit(p.name, 42)} delay={1.1} className="mt-6">{p.name}</Big>
        {p.tagline && <motion.p {...rise(1.4)} className="mt-2 text-[18px] italic">“{p.tagline}”</motion.p>}
        <motion.p {...rise(1.8)} className="mt-7 rounded-xl border-2 px-4 py-3 text-[15px]" style={{ borderColor: OV.paper, background: "rgba(251,246,236,0.12)" }}>{p.reason}</motion.p>
        {p.also.length > 0 && (
          <motion.p {...rise(2.2)} className="mt-4 text-[13px]" style={{ color: "#CFE3DE" }}>
            Also a bit of: {p.also.map((a) => `${a.emoji} ${a.name.replace(/^The /, "")}`).join(" · ")}
          </motion.p>
        )}
      </div>
    </WCard>
  );
}

export function SummaryCard({ d }: { d: WrappedData }) {
  const p = d.personality;
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="text-right">
          <span className="block font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
          {d.mode !== "all" && <span className="font-shelf-mono text-[10px] uppercase tracking-[0.1em]">{MODE_LABEL[d.mode]}</span>}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4">
        <div>
          <SmallLabel>Top channels{d.mode === "all" ? " · long" : ""}</SmallLabel>
          <ol className="mt-2 space-y-1.5">
            {d.top_channels.slice(0, 5).map((c, i) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className="w-3 font-ov-display text-[13px] font-extrabold">{i + 1}</span>
                <Face src={c.avatar_url} name={c.title} size={28} />
                <span className="truncate text-[13px] font-bold">{c.title}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <SmallLabel>Top genres</SmallLabel>
          <ol className="mt-2 space-y-1.5">
            {d.top_genres.slice(0, 5).map((g, i) => (
              <li key={g.key} className="flex h-7 items-center gap-2">
                <span className="w-3 font-ov-display text-[13px] font-extrabold">{i + 1}</span>
                <span className="truncate text-[13px] font-bold">{g.title}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {d.top_videos[0] && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border-2 p-2" style={{ borderColor: OV.ink, background: OV.paper }}>
          <img src={thumbOf(d.top_videos[0].key, d.top_videos[0].thumb)} alt="" className="h-[52px] w-[92px] shrink-0 rounded-lg border-2 object-cover" style={{ borderColor: OV.ink }} />
          <div className="min-w-0">
            <SmallLabel>Most rewatched · {d.top_videos[0].count}×</SmallLabel>
            <p className="line-clamp-2 text-[13px] font-bold leading-tight">{title(d.top_videos[0].title)}</p>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <StatBox label="Hours watched" value={num(hrs(d.overview.est_s))} sub="estimated" />
        <StatBox label="Videos" value={compact(d.overview.videos)} sub={`${num(d.overview.unique_channels)} channels`} />
        <StatBox label="Longest streak" value={d.streak ? `${d.streak.days} days` : "–"} />
        {d.mode === "all"
          ? <StatBox label="Top Shorts" value={d.top_shorts_channels[0]?.title ?? "–"} small />
          : <StatBox label="Peak hour" value={hourLabel(d.peak_hour)} />}
      </div>
      <PersonalityStrip p={p} />
    </WCard>
  );
}

/** The bottom strip of a summary card. */
export function PersonalityStrip({ p }: { p: WrappedData["personality"] }) {
  return (
    <div className="mt-auto flex items-center gap-3 rounded-xl border-2 px-3 py-2" style={{ background: OV.ink, color: OV.paper, borderColor: OV.ink }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[24px]" style={{ background: OV.mustard, borderColor: OV.paper }}>{p.emoji}</span>
      <div className="min-w-0">
        <p className="font-shelf-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: OV.mute }}>{who()} personality</p>
        <p className="truncate font-ov-display text-[20px] font-extrabold leading-tight">{p.name}</p>
      </div>
    </div>
  );
}

export function SmallLabel({ children }: { children: ReactNode }) {
  const t = useTone();
  return <p className="font-shelf-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: t.soft }}>{children}</p>;
}

/** Radial watch clock (plain SVG, so it saves cleanly). Midnight at the top; colors follow the card's tone. */
export function RadialClock({ data, peak }: { data: number[]; peak: number }) {
  const t = useTone();
  const max = Math.max(1, ...data);
  const size = 280, c = size / 2, inner = 46, outer = 128;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Watch clock">
      <circle cx={c} cy={c} r={inner - 4} fill="none" stroke={t.line} strokeOpacity={0.35} strokeWidth={2} />
      {data.map((v, h) => {
        const a0 = ((h / 24) * 360 - 90 + 1.5) * (Math.PI / 180);
        const a1 = (((h + 1) / 24) * 360 - 90 - 1.5) * (Math.PI / 180);
        const r = inner + (outer - inner) * (v / max);
        const p = (rad: number, a: number) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
        const d = `M${p(inner, a0)} L${p(r, a0)} A${r},${r} 0 0 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 0 0 ${p(inner, a0)}Z`;
        return (
          <motion.path key={h} d={d} fill={h === peak ? OV.mustard : t.fg} fillOpacity={h === peak ? 1 : 0.5}
                       initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + h * 0.04 }} />
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
        return (
          <text key={h} x={c + 30 * Math.cos(a)} y={c + 30 * Math.sin(a) + 4} textAnchor="middle" fontSize="10" fontFamily="DM Mono, monospace" fill={t.soft}>
            {hourLabel(h)}
          </text>
        );
      })}
    </svg>
  );
}
