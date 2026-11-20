import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, MotionGlobalConfig, motion } from "framer-motion";
import { Download, Loader2, Pause, Play, Share2, X } from "lucide-react";
import { toPng } from "html-to-image";
import { useQuery } from "@tanstack/react-query";
import { getJson, useMeta } from "../api";
import { num } from "../format";
import { CARDS, CARD_H, CARD_W, CardDef, YtMark } from "./cards";
import { WrappedData, WrappedMode } from "./types";

const SECONDS_PER_CARD = 7;

const MODES: [WrappedMode, string][] = [["all", "All"], ["videos", "Videos"], ["shorts", "Shorts"]];

/** Mode from ?mode=, else from the dashboard's content switch (?buckets=) so Wrapped opens the way you were browsing. */
function useMode(): [WrappedMode, (m: WrappedMode) => void] {
  const [params, setParams] = useSearchParams();
  const explicit = params.get("mode");
  let mode: WrappedMode = "all";
  if (explicit === "videos" || explicit === "shorts") mode = explicit;
  else if (!explicit) {
    const b = (params.get("buckets") ?? "").split(",").filter(Boolean).sort().join(",");
    if (b === "short") mode = "shorts";
    else if (b === "long,music") mode = "videos";
  }
  const set = (m: WrappedMode) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("buckets");
      next.delete("card");
      if (m === "all") next.set("mode", "all"); else next.set("mode", m);
      return next;
    }, { replace: true });
  return [mode, set];
}

function ModeSwitch({ mode, onChange }: { mode: WrappedMode; onChange: (m: WrappedMode) => void }) {
  return (
    <div className="inline-flex rounded-full bg-white/10 p-0.5 text-sm font-medium backdrop-blur" role="group" aria-label="Wrapped content"
         onPointerDown={(e) => e.stopPropagation()}>
      {MODES.map(([m, label]) => (
        <button key={m} aria-pressed={mode === m} onClick={() => onChange(m)}
                className={`rounded-full px-3.5 py-1 transition-colors ${mode === m ? "bg-white text-[#0f0f0f]" : "text-white/80 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function WrappedPage() {
  const [params] = useSearchParams();
  const year = Number(params.get("year")) || null;
  const [mode, setMode] = useMode();
  // ?still: show every card in its final state, no entrance animations
  MotionGlobalConfig.skipAnimations = params.has("still");
  return year ? <Story key={mode} year={year} mode={mode} setMode={setMode} /> : <YearPicker mode={mode} setMode={setMode} />;
}

// ------------------------------------------------------------------ year picker

function YearPicker({ mode, setMode }: { mode: WrappedMode; setMode: (m: WrappedMode) => void }) {
  const meta = useMeta().data;
  const years = [...(meta?.years ?? [])].reverse();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center bg-[radial-gradient(ellipse_at_top,#4a0012,#0f0f0f_60%)] px-5 py-10">
      <Link to="/" className="self-start text-sm text-sub hover:text-ink">‹ Back to dashboard</Link>
      <div className="mt-10 flex items-center gap-2"><YtMark size={40} /><span className="text-3xl font-black">Wrapped</span></div>
      <p className="mt-2 text-center text-sub">Pick a year for your story</p>
      <div className="mt-4"><ModeSwitch mode={mode} onChange={setMode} /></div>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
        {years.map((y, i) => (
          <motion.div key={y} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={`/wrapped?year=${y}&mode=${mode}`}
                  className="flex aspect-[4/5] flex-col justify-between rounded-2xl p-4 transition-transform hover:scale-[1.03]"
                  style={{ background: `linear-gradient(160deg, ${["#ff0033", "#7c3aed", "#f97316", "#0ea5e9", "#db2777", "#10b981"][i % 6]}, #1a1a1a 130%)` }}>
              <YtMark size={26} />
              <span className="text-4xl font-black">{y}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ story player

function available(card: CardDef, d: WrappedData): boolean {
  switch (card.id) {
    case "top-video": return d.top_videos.length > 0;
    case "biggest-day": return !!d.biggest_day;
    case "streak": return !!d.streak && d.streak.days > 1;
    case "night": return !!d.latest_night;
    case "discovery": return !!d.discovery;
    case "category": return d.top_categories.length > 0;
    case "shorts-channels": return d.top_shorts_channels.length > 0;
    case "shorts": return d.mode === "all";  // the Shorts vs long-form split only means something with both
    default: return true;
  }
}

function Story({ year, mode, setMode }: { year: number; mode: WrappedMode; setMode: (m: WrappedMode) => void }) {
  const q = useQuery<WrappedData>({ queryKey: ["wrapped", year, mode], queryFn: () => getJson(`/api/wrapped/${year}?mode=${mode}`) });
  if (q.error) return <Fullscreen><p className="text-sub">Couldn't load your {year}: {(q.error as Error).message}</p></Fullscreen>;
  if (!q.data) return <Fullscreen><Loader2 className="animate-spin text-sub" size={32} /></Fullscreen>;
  if (q.data.empty)
    return (
      <Fullscreen>
        <p className="text-sub">No {mode === "all" ? "watch history" : mode === "shorts" ? "Shorts" : "videos"} in {year}.</p>
        <div className="mt-4"><ModeSwitch mode={mode} onChange={setMode} /></div>
        <Link to="/wrapped" className="mt-4 underline">Pick another year</Link>
      </Fullscreen>
    );
  return <Player data={q.data} setMode={setMode} />;
}

function Fullscreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg p-6 text-center">{children}</div>;
}

function Player({ data, setMode }: { data: WrappedData; setMode: (m: WrappedMode) => void }) {
  const cards = useMemo(() => CARDS.filter((c) => available(c, data)), [data]);
  // ?card=<id> opens the story on that card, paused (handy for linking to one card)
  const [params] = useSearchParams();
  const startAt = Math.max(0, cards.findIndex((c) => c.id === params.get("card")));
  const [i, setI] = useState(startAt);
  const [paused, setPaused] = useState(params.has("card"));
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number>();
  const held = useRef(false);
  const last = i === cards.length - 1;

  const next = useCallback(() => setI((x) => Math.min(x + 1, cards.length - 1)), [cards.length]);
  const prev = useCallback(() => setI((x) => Math.max(x - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // tap left third = back, elsewhere = forward; press and hold = pause
  const onPointerDown = () => {
    held.current = false;
    holdTimer.current = window.setTimeout(() => { held.current = true; setPaused(true); }, 220);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    window.clearTimeout(holdTimer.current);
    if (held.current) { setPaused(false); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) prev(); else next();
  };

  const exportCard = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setPaused(true);
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 1080 / CARD_W, width: CARD_W, height: CARD_H, cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = `youtube-wrapped-${data.year}-${cards[i].id}.png`;
      a.click();
    } catch (err) {
      alert(`Couldn't create the image: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 flex select-none flex-col items-center justify-center bg-black">
      {/* blurred backdrop on wide screens */}
      <div className="pointer-events-none absolute inset-0 hidden opacity-40 blur-3xl sm:block"
           style={{ background: "radial-gradient(circle at 30% 30%, #ff0033, transparent 55%), radial-gradient(circle at 70% 70%, #7c3aed, transparent 55%)" }} />
      <Stage>
        {(scale) => (
          <div className="relative overflow-hidden sm:rounded-[28px] sm:shadow-2xl" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
            <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
              <AnimatePresence mode="wait">
                <motion.div key={cards[i].id} ref={cardRef} style={{ width: CARD_W, height: CARD_H }}
                            initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.35 }}>
                  {cards[i].render(data)}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* overlay: progress, controls (not part of the exported card) */}
            <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
                 onPointerLeave={() => window.clearTimeout(holdTimer.current)} />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-3">
              {cards.map((c, k) => (
                <div key={c.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                  {k < i && <div className="h-full w-full bg-white" />}
                  {k === i && (
                    <div key={`${i}`} className="h-full bg-white"
                         style={{ animation: `wrapped-progress ${SECONDS_PER_CARD}s linear forwards`, animationPlayState: paused || exporting ? "paused" : "running" }}
                         onAnimationEnd={() => !last && next()} />
                  )}
                </div>
              ))}
            </div>
            <div className="absolute right-2 top-6 flex items-center gap-1">
              <IconBtn label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>{paused ? <Play size={18} /> : <Pause size={18} />}</IconBtn>
              <IconBtn label="Save this card as an image" onClick={exportCard}>{exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}</IconBtn>
              <Link to="/wrapped" aria-label="Close" className="rounded-full p-2 text-white/90 hover:bg-black/25"><X size={20} /></Link>
            </div>
          </div>
        )}
      </Stage>
      {/* bar under the card: content switch, then the share button on the last card, otherwise hints */}
      <div className="relative z-10 flex h-24 flex-col items-center justify-center gap-2">
        <ModeSwitch mode={data.mode} onChange={setMode} />
        {last ? (
          <button onClick={exportCard} disabled={exporting}
                  className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#0f0f0f] shadow-xl hover:bg-white/90">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save share image (1080×1920)
          </button>
        ) : (
          <span className="text-xs text-white/50">
            <span className="sm:hidden">Tap to continue · hold to pause</span>
            <span className="hidden sm:inline">← → to move · space to pause</span> · {num(i + 1)}/{cards.length}
          </span>
        )}
      </div>
      <style>{`@keyframes wrapped-progress { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} onPointerDown={(e) => e.stopPropagation()}
            className="rounded-full p-2 text-white/90 hover:bg-black/25">
      {children}
    </button>
  );
}

/** Measures the viewport and gives the scale that fits a 9:16 card: full-screen on phones, framed on desktop. */
function Stage({ children }: { children: (scale: number) => React.ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const phone = window.innerWidth < 640;
      const w = phone ? window.innerWidth : window.innerWidth - 48;
      const h = (phone ? window.innerHeight : window.innerHeight - 32) - 96; // 96 = bar under the card
      setScale(Math.min(w / CARD_W, h / CARD_H, phone ? Infinity : 1.45));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return <div className="relative z-10">{children(scale)}</div>;
}
