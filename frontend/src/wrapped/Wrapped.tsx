import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_PLATFORM, Link, useCapability, usePlatformId } from "../platform";
import { useStats, MonthPoint } from "../api";
import { useFilters } from "../filters";
import { Avatar, OV, PageBody, PageHeader, Seg, Skeleton, TopBar, kicker } from "../overview/kit";
import { YearTop } from "../overview/ReignTimeline";
import { rankingFilters, yearlyHours } from "../overview/takeaways";
import { AnimatePresence, MotionGlobalConfig, motion } from "framer-motion";
import { Download, Loader2, Pause, Play, Share2, X } from "lucide-react";
import { toPng } from "html-to-image";
import { useQuery } from "@tanstack/react-query";
import { getJson, useMeta } from "../api";
import { num } from "../format";
import { CARDS, CARD_H, CARD_W, CardDef } from "./cards";
import { SHOWS_CARDS } from "./showsCards";
import { AnyWrapped, WrappedData, WrappedMode } from "./types";

/** The platform's name and the file name for saved cards. */
function useBrand() {
  const p = useMeta().data?.platform;
  const id = p?.id ?? "youtube";
  return { name: p?.name ?? "YouTube", file: `${id}-wrapped` };
}

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

function ModeSwitch({ mode, onChange, dark = false }: { mode: WrappedMode; onChange: (m: WrappedMode) => void; dark?: boolean }) {
  if (!useCapability("shorts")) return null;
  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <Seg label="Wrapped content" dark={dark} value={mode} options={MODES} onChange={onChange} />
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

const TILE: [string, string][] = [[OV.mustard, OV.ink], [OV.paper, OV.ink], [OV.teal, OV.paper], [OV.ink, OV.paper]];

function YearPicker({ mode, setMode }: { mode: WrappedMode; setMode: (m: WrappedMode) => void }) {
  const meta = useMeta().data;
  const brand = useBrand();
  const { filters } = useFilters();
  // each year's hours and its #1, so a tile says what's inside
  const all = { ...filters, range: "all", metric: "time" as const };
  const months = useStats<{ data: MonthPoint[] }>("patterns/monthly", {}, { filters: all });
  const tops = useStats<YearTop[]>("evolution/top_per_year", {}, { filters: rankingFilters(all) });
  const hours = new Map(yearlyHours(months.data?.data ?? []).map((y) => [y.year, y.hours]));
  const top = new Map((tops.data ?? []).map((t) => [t.year, t]));
  const years = [...(meta?.years ?? [])].reverse();
  const thisYear = Number(meta?.today.slice(0, 4));
  return (
    <div className="min-h-[100dvh] font-shelf-sans" style={{ background: OV.bg, color: OV.ink, colorScheme: "light" }}>
      <TopBar />
      <PageHeader label={`${brand.name} Wrapped`} title="Pick a year for your story.">
        <p className="text-[17px]" style={{ color: OV.mute }}>A short story of your year: your #1, your hours, your habits. Save any card as an image.</p>
        <ModeSwitch mode={mode} onChange={setMode} dark />
      </PageHeader>
      <PageBody>
        {!meta ? <Skeleton h={400} /> : (
          <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {years.map((y, i) => {
              const [bg, fg] = TILE[i % TILE.length];
              const t = top.get(y);
              const h = hours.get(y);
              return (
                <motion.li key={y} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <Link to={`/wrapped?year=${y}&mode=${mode}`}
                        className="flex aspect-[5/4] flex-col justify-between rounded-2xl border-2 p-4 transition-transform hover:-translate-y-1 sm:p-5"
                        style={{ background: bg, color: fg, borderColor: OV.ink }}>
                    <span className="flex items-start justify-between gap-2">
                      <span className={kicker}>{y === thisYear ? "So far" : "Wrapped"}</span>
                      {t && <Avatar src={t.avatar_url} name={t.title} size={72} ring={fg === OV.paper ? OV.paper : OV.ink} />}
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="font-ov-display text-[clamp(44px,6vw,64px)] font-extrabold leading-none tracking-[-0.03em]">{y}</span>
                      <span className="font-shelf-mono text-[12px]">{h != null ? `${num(h)} hours` : " "}</span>
                      {t?.title && <span className="truncate text-[14px] font-bold">#1 {t.title}</span>}
                    </span>
                  </Link>
                </motion.li>
              );
            })}
          </ol>
        )}
      </PageBody>
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
  const platform = usePlatformId() ?? DEFAULT_PLATFORM;
  const q = useQuery<AnyWrapped>({
    queryKey: ["wrapped", platform, year, mode],
    queryFn: () => getJson(`/api/wrapped/${year}?mode=${mode}&platform=${platform}`),
  });
  if (q.error) return <Fullscreen><p>Couldn't load your {year}: {(q.error as Error).message}</p></Fullscreen>;
  if (!q.data) return <Fullscreen><Loader2 className="animate-spin" size={32} /></Fullscreen>;
  if (q.data.empty)
    return (
      <Fullscreen>
        <p className="font-ov-display text-[28px] font-extrabold">No {mode === "all" ? "watch history" : mode === "shorts" ? "Shorts" : "videos"} in {year}.</p>
        <ModeSwitch mode={mode} onChange={setMode} />
        <Link to="/wrapped" className="font-shelf-mono text-[13px] underline underline-offset-4">Pick another year ›</Link>
      </Fullscreen>
    );
  return <Player data={q.data} setMode={setMode} />;
}

function Fullscreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] font-shelf-sans" style={{ background: OV.bg, color: OV.ink, colorScheme: "light" }}>
      <TopBar />
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>
    </div>
  );
}

function Player({ data, setMode }: { data: AnyWrapped; setMode: (m: WrappedMode) => void }) {
  const brand = useBrand();
  // each card set renders its own platform's data
  const cards = useMemo<CardDef<AnyWrapped>[]>(() => ("kind_split" in data
    ? (SHOWS_CARDS as CardDef<AnyWrapped>[]).filter((c) => !c.when || c.when(data))
    : (CARDS as CardDef<AnyWrapped>[]).filter((c) => available(c as CardDef, data as WrappedData))), [data]);
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
      a.download = `${brand.file}-${data.year}-${cards[i].id}.png`;
      a.click();
    } catch (err) {
      alert(`Couldn't create the image: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // the controls take one more line when there's a Videos / Shorts switch
  const bottom = useCapability("shorts") ? 148 : 100;
  const phone = usePhone();
  const segs = (
    <div className="flex w-full gap-1" aria-hidden>
      {cards.map((c, k) => (
        <div key={c.id} className="h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(127,115,100,0.35)" }}>
          {k < i && <div className="h-full w-full" style={{ background: OV.mustard }} />}
          {k === i && (
            <div key={`${i}`} className="h-full" style={{ background: OV.mustard,
                 animation: `wrapped-progress ${SECONDS_PER_CARD}s linear forwards`, animationPlayState: paused || exporting ? "paused" : "running" }}
                 onAnimationEnd={() => !last && next()} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    // phones: the story fills the screen on ink; wider screens: the top bar, then the card on the cream page
    <div className="fixed inset-0 flex select-none flex-col font-shelf-sans sm:bg-[#F4EEE3]" style={{ background: undefined, color: OV.ink }}>
      <div className="absolute inset-0 sm:hidden" style={{ background: OV.ink }} />
      <div className="relative z-20 hidden sm:block"><TopBar /></div>
      <div className="relative flex flex-1 flex-col items-center justify-center">
        <Stage bottom={bottom}>
          {(scale) => (
            <div className="flex flex-col items-center gap-2.5" style={{ width: CARD_W * scale }}>
              {segs}
              <div className="relative overflow-hidden sm:rounded-[22px] sm:border-[3px]"
                   style={{ width: CARD_W * scale, height: CARD_H * scale, borderColor: OV.ink, boxShadow: "6px 6px 0 rgba(26,23,20,0.9)" }}>
                <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                  <AnimatePresence mode="wait">
                    <motion.div key={cards[i].id} ref={cardRef} style={{ width: CARD_W, height: CARD_H }}
                                initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                                transition={{ duration: 0.35 }}>
                      {cards[i].render(data)}
                    </motion.div>
                  </AnimatePresence>
                </div>
                {/* tap areas (not part of the exported card) */}
                <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
                     onPointerLeave={() => window.clearTimeout(holdTimer.current)} />
              </div>
            </div>
          )}
        </Stage>
        {/* under the card: controls, the content switch, then hints (or the share button on the last card) */}
        <div className="relative z-10 flex flex-col items-center justify-center gap-2 py-2" style={{ height: bottom }}>
          <div className="flex items-center gap-2">
            <Btn label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>{paused ? <Play size={17} /> : <Pause size={17} />}</Btn>
            {last ? (
              <button onClick={exportCard} disabled={exporting}
                      className="flex min-h-10 items-center gap-2 rounded-full border-2 px-4 text-[14px] font-bold hover:brightness-105"
                      style={{ background: OV.mustard, color: OV.ink, borderColor: OV.ink }}>
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save share image
              </button>
            ) : (
              <Btn label="Save this card as an image" onClick={exportCard}>{exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}</Btn>
            )}
            <Link to="/wrapped" aria-label="Close" title="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2" style={{ background: OV.paper, borderColor: OV.ink, color: OV.ink }}>
              <X size={18} />
            </Link>
          </div>
          <ModeSwitch mode={data.mode} onChange={setMode} dark={phone} />
          <span className="font-shelf-mono text-[12px] text-[#B9AE9C] sm:text-[#5C5348]">
            <span className="sm:hidden">Tap to continue · hold to pause</span>
            <span className="hidden sm:inline">← → to move · space to pause</span> · {num(i + 1)}/{cards.length}
          </span>
        </div>
      </div>
      <style>{`@keyframes wrapped-progress { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  );
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} onPointerDown={(e) => e.stopPropagation()}
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 hover:brightness-95"
            style={{ background: OV.paper, borderColor: OV.ink, color: OV.ink }}>
      {children}
    </button>
  );
}

/** Measures the space and gives the scale that fits a 9:16 card: full-screen on phones, framed under the top bar
 *  on wider screens (the progress bars sit above the card, the controls below). */
function Stage({ children, bottom }: { children: (scale: number) => React.ReactNode; bottom: number }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const phone = window.innerWidth < 640;
      const w = phone ? window.innerWidth - 16 : window.innerWidth - 48;
      const h = window.innerHeight - (phone ? 16 : 64 + 24) - bottom - 18;  // top bar, controls, progress bars
      setScale(Math.min(w / CARD_W, h / CARD_H, phone ? Infinity : 1.3));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [bottom]);
  return <div className="relative z-10">{children(scale)}</div>;
}

/** True on phone-sized screens (the story fills the screen on ink there). */
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const on = () => setPhone(window.innerWidth < 640);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return phone;
}
