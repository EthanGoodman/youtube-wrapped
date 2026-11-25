/* Parts for the Wrapped story cards in the shared look (cream / ink / mustard / teal, ink outlines, Bricolage numbers).
   Every card is laid out at 360 x 640 and saved as an image, so everything here is plain HTML or SVG. A card's tone
   sets its colors; the parts read it from context so a card only says "teal" once. */
import { ReactNode, createContext, useContext, useState } from "react";
import { motion } from "framer-motion";
import { platformName } from "../platform";
import { OV } from "../overview/kit";
import { img } from "./types";

export type Tone = "ink" | "cream" | "mustard" | "teal" | "paper" | "accent";

interface ToneColors { bg: string; fg: string; soft: string; hi: string; line: string; well: string }
/** fg = text, soft = secondary text, hi = the highlight color for big numbers, line = outlines, well = boxes inside */
const TONES: Record<Tone, ToneColors> = {
  ink: { bg: OV.ink, fg: OV.paper, soft: OV.mute, hi: OV.mustard, line: OV.paper, well: "rgba(251,246,236,0.08)" },
  cream: { bg: OV.bg, fg: OV.ink, soft: OV.soft, hi: OV.accent, line: OV.ink, well: OV.paper },
  paper: { bg: OV.paper, fg: OV.ink, soft: OV.soft, hi: OV.teal, line: OV.ink, well: OV.bg },
  mustard: { bg: OV.mustard, fg: OV.ink, soft: "#5A4413", hi: OV.ink, line: OV.ink, well: "rgba(251,246,236,0.45)" },
  teal: { bg: OV.teal, fg: OV.paper, soft: "#CFE3DE", hi: OV.mustard, line: OV.paper, well: "rgba(251,246,236,0.12)" },
  accent: { bg: OV.accent, fg: OV.paper, soft: "#F3CDBF", hi: OV.mustard, line: OV.paper, well: "rgba(26,23,20,0.18)" },
};

const ToneCtx = createContext<ToneColors>(TONES.cream);
export const useTone = () => useContext(ToneCtx);

export const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.55, ease: [0.2, 0.8, 0.2, 1] },
});
export const pop = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  transition: { delay, type: "spring", stiffness: 160, damping: 14 },
});

/** One story card: its tone, a big decorative ring in a corner, the content, and a footer with the wordmark. */
export function WCard({ tone, children, footer = true, tag, ring = "tr" }: {
  tone: Tone; children: ReactNode; footer?: boolean; tag?: string; ring?: "tr" | "bl" | "none";
}) {
  const t = TONES[tone];
  return (
    <ToneCtx.Provider value={t}>
      <div className="relative flex h-full w-full flex-col overflow-hidden font-shelf-sans" style={{ background: t.bg, color: t.fg }}>
        {ring !== "none" && (
          <span aria-hidden className="pointer-events-none absolute h-[300px] w-[300px] rounded-full border-[28px] opacity-[0.09]"
                style={{ borderColor: t.fg, ...(ring === "tr" ? { right: -120, top: -110 } : { left: -130, bottom: -120 }) }} />
        )}
        <div className="relative z-10 flex flex-1 flex-col px-7 pb-5 pt-12">{children}</div>
        {footer && <Footer tag={tag} />}
      </div>
    </ToneCtx.Provider>
  );
}

/** "YouTube Wrapped · 2025": our own wordmark, never the service's logo. */
export function Footer({ tag }: { tag?: string }) {
  const t = useTone();
  return (
    <div className="relative z-10 flex items-center justify-between px-7 pb-6">
      <Wordmark />
      {tag && <span className="font-shelf-mono text-[12px]" style={{ color: t.soft }}>{tag}</span>}
    </div>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  const t = useTone();
  return (
    <span className="flex items-center gap-1.5 font-ov-display font-extrabold tracking-[-0.01em]" style={{ fontSize: size }}>
      <span aria-hidden className="inline-block rounded-full border-2" style={{ width: size * 0.9, height: size * 0.9, borderColor: t.fg, background: OV.mustard }} />
      {platformName()} Wrapped
    </span>
  );
}

/** The sentence that sets up a card. */
export function Kicker({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const t = useTone();
  return <motion.p {...rise(delay)} className="text-[18px] font-medium leading-snug" style={{ color: t.soft }}>{children}</motion.p>;
}

/** Small uppercase label (mono), like the stats pages. */
export function Label({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const t = useTone();
  return <motion.p {...rise(delay)} className={`font-shelf-mono text-[11px] uppercase tracking-[0.12em] ${className}`} style={{ color: t.soft }}>{children}</motion.p>;
}

/** Big Bricolage text; `hi` paints it in the tone's highlight color. */
export function Big({ children, size = 64, delay = 0.2, hi = false, className = "" }: {
  children: ReactNode; size?: number; delay?: number; hi?: boolean; className?: string;
}) {
  const t = useTone();
  return (
    <motion.div {...rise(delay)} className={`break-words font-ov-display font-extrabold leading-[0.92] tracking-[-0.03em] ${className}`}
                style={{ fontSize: size, color: hi ? t.hi : undefined }}>
      {children}
    </motion.div>
  );
}

/** A headline size that fits the card: long names step down so they never run off the edge (card is ~306px wide). */
export function fit(text: string | null | undefined, base: number, min = 26): number {
  const n = (text ?? "").length || 1;
  // Bricolage ExtraBold is about 0.56em per character on average; allow two lines for long names
  const oneLine = 306 / (n * 0.56);
  const size = n > 14 ? Math.max(oneLine * 1.8, min) : oneLine;
  return Math.round(Math.max(min, Math.min(base, size)));
}

/** A round face with the outline (channels). */
export function Face({ src, name, size }: { src?: string | null; name?: string | null; size: number }) {
  const t = useTone();
  const [failed, setFailed] = useState(false);
  const url = img(src);
  const box = { width: size, height: size, borderColor: t.line, borderWidth: Math.max(2, Math.round(size / 40)) };
  if (!url || failed)
    return <div className="flex shrink-0 items-center justify-center rounded-full font-ov-display font-extrabold"
                style={{ ...box, borderStyle: "solid", background: OV.sand, color: OV.ink, fontSize: size * 0.4 }}>{(name ?? "?").charAt(0).toUpperCase()}</div>;
  return <img src={url} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-full object-cover" style={{ ...box, borderStyle: "solid" }} />;
}

/** A poster (2:3) with the outline (shows); TMDB sizes go up when shown big. */
export function PosterImg({ src, name, w, big = false }: { src?: string | null; name?: string | null; w: number; big?: boolean }) {
  const t = useTone();
  const [failed, setFailed] = useState(false);
  const url = img(big && src ? src.replace("/w185/", "/w500/") : src);
  const box = { width: w, height: Math.round(w * 1.5), borderColor: t.line, borderWidth: w >= 100 ? 3 : 2, borderStyle: "solid" as const };
  if (!url || failed)
    return <div className="flex shrink-0 items-center justify-center rounded-lg px-1 text-center font-ov-display font-extrabold"
                style={{ ...box, background: OV.sand, color: OV.ink, fontSize: Math.max(11, w / 7) }}>{name ?? "?"}</div>;
  return <img src={url} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-lg object-cover" style={box} />;
}

/** Square album art with the outline (music); a big initial when there's no picture. */
export function CoverImg({ src, name, w }: { src?: string | null; name?: string | null; w: number }) {
  const t = useTone();
  const [failed, setFailed] = useState(false);
  const url = img(src);
  const box = { width: w, height: w, borderColor: t.line, borderWidth: w >= 100 ? 3 : 2, borderStyle: "solid" as const };
  if (!url || failed)
    return <div className="flex shrink-0 items-center justify-center rounded-lg font-ov-display font-extrabold"
                style={{ ...box, background: OV.sand, color: OV.ink, fontSize: w * 0.4 }}>{(name ?? "?").charAt(0).toUpperCase()}</div>;
  return <img src={url} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-lg object-cover" style={box} />;
}

/** A 16:9 thumbnail with the outline (videos, episodes). */
export function Thumb({ src, className = "" }: { src?: string | null; className?: string }) {
  const t = useTone();
  return src
    ? <img src={src} alt="" className={`aspect-video w-full rounded-xl border-[3px] object-cover ${className}`} style={{ borderColor: t.line }} />
    : <div className={`aspect-video w-full rounded-xl border-[3px] ${className}`} style={{ borderColor: t.line, background: OV.sand }} />;
}

/** The round, tilted sticker ("#1"). */
export function Sticker({ children, size = 58, delay = 1.2 }: { children: ReactNode; size?: number; delay?: number }) {
  return (
    <motion.span initial={{ opacity: 0, scale: 0.3, rotate: -30 }} animate={{ opacity: 1, scale: 1, rotate: 8 }}
                 transition={{ delay, type: "spring", stiffness: 180, damping: 12 }}
                 className="absolute -right-3 -top-2 flex items-center justify-center rounded-full border-[3px] font-ov-display font-extrabold"
                 style={{ width: size, height: size, fontSize: size * 0.36, background: OV.mustard, color: OV.ink, borderColor: OV.ink }}>
      {children}
    </motion.span>
  );
}

/** A labeled bar that grows in. */
export function GrowBar({ label, value, share, delay, color }: { label: ReactNode; value: ReactNode; share: number; delay: number; color?: string }) {
  const t = useTone();
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-[15px] font-bold"><span className="truncate">{label}</span><span className="shrink-0">{value}</span></div>
      <div className="h-4 overflow-hidden rounded-full border-2" style={{ borderColor: t.line, background: t.well }}>
        <motion.div className="h-full" style={{ background: color ?? t.hi }} initial={{ width: 0 }}
                    animate={{ width: `${Math.max(1.5, share * 100)}%` }} transition={{ delay, duration: 1 }} />
      </div>
    </div>
  );
}

/** A small outlined box with a label and a number (summary cards). */
export function StatBox({ label, value, sub, small = false }: { label: string; value: string; sub?: string; small?: boolean }) {
  const t = useTone();
  return (
    <div className="min-w-0 rounded-xl border-2 px-3 py-2" style={{ borderColor: t.line, background: t.well }}>
      <p className="font-shelf-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: t.soft }}>{label}</p>
      <p className={`truncate font-ov-display font-extrabold leading-tight ${small ? "pt-0.5 text-[16px]" : "text-[24px]"}`}>{value}</p>
      {sub && <p className="truncate text-[10px]" style={{ color: t.soft }}>{sub}</p>}
    </div>
  );
}

/** A row of day squares lighting up (streaks), like the Records page. */
export function StreakStrip({ days, delay = 0.6 }: { days: number; delay?: number }) {
  const t = useTone();
  const n = 35;
  return (
    <div aria-hidden className="grid gap-[5px]" style={{ gridTemplateColumns: "repeat(7,minmax(0,1fr))" }}>
      {Array.from({ length: n }, (_, i) => (
        <motion.span key={i} className="aspect-square rounded-[4px] border-2" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
                     transition={{ delay: delay + i * 0.025 }}
                     style={{ borderColor: t.line, background: i < Math.min(days, n) ? OV.mustard : "transparent" }} />
      ))}
    </div>
  );
}

/** The personality's emoji in a big outlined circle. */
export function Badge({ children, size = 150, delay = 0.5 }: { children: ReactNode; size?: number; delay?: number }) {
  const t = useTone();
  return (
    <motion.div initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay, type: "spring", stiffness: 110, damping: 11 }}
                className="flex items-center justify-center rounded-full border-[4px]"
                style={{ width: size, height: size, borderColor: t.line, background: OV.mustard, fontSize: size * 0.5, lineHeight: 1 }}>
      {children}
    </motion.div>
  );
}
