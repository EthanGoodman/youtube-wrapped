/* The shared kit for the new stats pages (YouTube first; meant for every platform in the family): the palette,
   the frame (top bar, period and content pickers), and small parts. Only `OV.accent` is the app's own color. */
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { HubLink, Link, useCapability, usePlatform } from "../platform";
import { RankedItem, TopResponse, useMeta, useStats } from "../api";
import { ALL_BUCKETS, Bucket, Filters, useFilters, useLinkQuery } from "../filters";
import { Comparison, Move, comparison } from "./takeaways";

/** The palette (shared by every platform; only `accent` is the app's own color). */
export const OV = {
  bg: "#F4EEE3", paper: "#FBF6EC", ink: "#1A1714", ink2: "#24201C", soft: "#5C5348", sand: "#E3D8C2",
  mustard: "#E2A93B", teal: "#2E6B63", accent: "#B83A24", mute: "#B9AE9C",
};

type Tab = [string, string, boolean?, string?];
type MoreLink = [string, string, string?];
/* Each family's tabs follow the priority table: universal + must-haves are tabs, nice-to-haves and things people only
   look for on purpose live behind "More" (the third item is a capability the platform needs for that link). */
const NAV: Record<"videos" | "shows", { tabs: Tab[]; more: MoreLink[] }> = {
  videos: {
    tabs: [["/", "Overview", true], ["/top/channels", "Top channels"], ["/evolution", "Evolution"], ["/patterns", "Patterns"], ["/records", "Records"]],
    more: [["/top/videos", "Top videos"], ["/top/genres", "Top genres"], ["/ads", "Ads you saw", "ads"], ["/search", "Search history", "search"]],
  },
  shows: {
    // "Top shows" takes the platform's word (Top series); Anime is Crunchyroll's own tab
    tabs: [["/", "Overview", true], ["/top/channels", "Top shows"], ["/shows", "How far you got"], ["/anime", "Anime", false, "anime"], ["/patterns", "Patterns"], ["/records", "Records"]],
    more: [["/evolution", "Evolution"], ["/top/genres", "Top genres"], ["/top/movies", "Top movies", "!anime"]],
  },
};

/** Which family's pages a platform gets: shows (Netflix) or videos (YouTube). */
export function useFamily(): "videos" | "shows" {
  return useCapability("series") ? "shows" : "videos";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What one watched thing is called, from the platform's own words: a video, a title (Netflix), an episode (Crunchyroll). */
export function useNoun(): { one: string; many: string; Many: string } {
  const v = usePlatform()?.vocab;
  const shows = useFamily() === "shows";
  const one = v?.item ?? (shows ? "title" : "video");
  const many = v?.items ?? (shows ? "titles" : "videos");
  return { one, many, Many: cap(many) };
}

/** What the things you return to are called: channels, shows (Netflix), series (Crunchyroll). */
export function useCreator(): { one: string; many: string; Many: string } {
  const v = usePlatform()?.vocab;
  const shows = useFamily() === "shows";
  const one = v?.creator ?? (shows ? "show" : "channel");
  const many = v?.creators ?? (shows ? "shows" : "channels");
  return { one, many, Many: cap(many) };
}

/** Each platform's own color, used sparingly (the hero's warm backdrop). */
const ACCENTS: Record<string, string> = { youtube: "#B83A24", netflix: "#B8322A", crunchyroll: "#D9601C" };
export function useAccent(): string {
  return ACCENTS[useMeta().data?.platform.id ?? ""] ?? OV.accent;
}

// ------------------------------------------------------------------ frame

export function TopBar() {
  const q = useLinkQuery();
  const { pathname } = useLocation();
  const meta = useMeta().data;
  const thisYear = meta?.today.slice(0, 4);
  const caps = meta?.platform.capabilities;
  const nav = NAV[useFamily()];
  const cr = useCreator();
  // a link that needs a capability ("!x": one the platform must not have)
  const has = (cap?: string) => !cap || !caps || (cap.startsWith("!") ? !caps.includes(cap.slice(1)) : caps.includes(cap));
  const tabs = nav.tabs.filter(([, , , cap]) => has(cap));
  const more = nav.more.filter(([, , cap]) => has(cap));
  return (
    <header style={{ background: OV.ink, color: OV.paper }}>
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8 lg:h-16 lg:flex-nowrap lg:py-0">
        <HubLink to="/" className="inline-flex min-h-11 items-center font-shelf-mono text-[13px] hover:underline">‹ Shelf</HubLink>
        <span className="font-ov-display text-[26px] font-extrabold tracking-[-0.02em]">{meta?.platform.name ?? "YouTube"}</span>
        <ScrollRow bg={OV.ink} outer="order-last -mx-1 w-full lg:order-none lg:mx-0 lg:w-auto lg:flex-1" className="px-1 lg:overflow-visible lg:px-0">
        <nav aria-label="Sections" className="flex w-max items-center gap-1 lg:w-auto">
          {tabs.map(([to, label, end]) => {
            const on = end ? pathname.replace(/\/$/, "").split("/").length <= 2 : pathname.includes(to);
            return (
              <Link key={to} to={to + q} aria-current={on ? "page" : undefined}
                    className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium hover:underline"
                    style={on ? { background: OV.mustard, color: OV.ink } : undefined}>
                {to === "/top/channels" ? `Top ${cr.many}` : label}
              </Link>
            );
          })}
          {/* phones: the extras are just more tabs in the scrolling row (a dropdown would be clipped there) */}
          {more.map(([to, label]) => (
            <Link key={to} to={to + q} className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium lg:hidden">{label}</Link>
          ))}
          <details className="relative hidden shrink-0 lg:block">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium hover:underline">More ▾</summary>
            <div className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-col rounded-xl border-2 p-1 shadow-xl"
                 style={{ background: OV.paper, color: OV.ink, borderColor: OV.ink }}>
              {more.map(([to, label]) => (
                <Link key={to} to={to + q} className="rounded-lg px-3 py-2.5 text-[14px] hover:bg-black/5">{label}</Link>
              ))}
            </div>
          </details>
        </nav>
        </ScrollRow>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PeriodPicker />
          <ContentPicker />
          {thisYear && (
            <Link to={`/wrapped?year=${thisYear}`}
                  className="inline-flex min-h-10 items-center whitespace-nowrap rounded-[10px] px-4 text-[15px] font-bold hover:brightness-105"
                  style={{ background: OV.mustard, color: OV.ink }}>
              Your {thisYear} Wrapped
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

const selectCls = "min-h-10 w-[122px] rounded-[10px] border-2 px-2 font-shelf-mono text-[13px]";
const selectStyle = { borderColor: "#4A433B", background: OV.ink2, color: OV.paper, colorScheme: "dark" as const };

export function PeriodPicker() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const [custom, setCustom] = useState(false);
  const years = [...(meta?.years ?? [])].reverse();
  return (
    <div className="relative">
      <label>
        <span className="sr-only">Period</span>
        <select className={selectCls} style={selectStyle} value={filters.range}
                onChange={(e) => (e.target.value === "custom" || e.target.value === "pick" ? setCustom(true) : update({ range: e.target.value }))}>
          <option value="this_year">This year</option>
          <option value="4w">Past 4 weeks</option>
          <option value="6m">Past 6 months</option>
          <option value="all">Lifetime</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          {/* choosing the selected option fires no change, so an active custom range gets its own way back to the dates */}
          {filters.range === "custom" && <option value="custom">{`${filters.start} – ${filters.end}`}</option>}
          <option value="pick">{filters.range === "custom" ? "Change dates…" : "Custom…"}</option>
        </select>
      </label>
      {custom && <CustomDates onDone={() => setCustom(false)} min={meta?.first_date} max={meta?.today} />}
    </div>
  );
}

export function CustomDates({ onDone, min, max }: { onDone: () => void; min?: string | null; max?: string }) {
  const { filters, update } = useFilters();
  const [start, setStart] = useState(filters.start ?? min ?? "");
  const [end, setEnd] = useState(filters.end ?? max ?? "");
  const input = "mt-1 w-full rounded-lg border-2 px-2 py-1.5 text-sm";
  return (
    <form className="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-2 rounded-xl border-2 p-3 shadow-lg"
          style={{ borderColor: OV.ink, background: OV.paper, color: OV.ink, colorScheme: "light" }}
          onSubmit={(e) => { e.preventDefault(); if (start && end) { update({ range: "custom", start, end }); onDone(); } }}>
      <label className="text-xs">From
        <input type="date" value={start} min={min ?? undefined} max={max} onChange={(e) => setStart(e.target.value)}
               className={input} style={{ borderColor: OV.ink }} />
      </label>
      <label className="text-xs">To
        <input type="date" value={end} min={min ?? undefined} max={max} onChange={(e) => setEnd(e.target.value)}
               className={input} style={{ borderColor: OV.ink }} />
      </label>
      <div className="mt-1 flex gap-2">
        <button type="submit" className="min-h-10 flex-1 rounded-lg font-bold" style={{ background: OV.ink, color: OV.bg }}>Apply</button>
        <button type="button" onClick={onDone} className="min-h-10 flex-1 rounded-lg border-2" style={{ borderColor: OV.ink }}>Cancel</button>
      </div>
    </form>
  );
}

const CONTENT: [string, string, Bucket[]][] = [
  ["all", "All videos", ALL_BUCKETS], ["videos", "Long videos", ["long", "music"]], ["shorts", "Shorts", ["short"]],
];

export function ContentPicker() {
  const { filters, update } = useFilters();
  if (!useCapability("shorts")) return null;
  const same = (a: Bucket[], b: Bucket[]) => a.length === b.length && a.every((x) => b.includes(x));
  const current = CONTENT.find(([, , b]) => same(filters.buckets, b))?.[0] ?? "custom";
  return (
    <label>
      <span className="sr-only">Show</span>
      <select className={selectCls} style={selectStyle} value={current}
              onChange={(e) => { const c = CONTENT.find(([k]) => k === e.target.value); if (c) update({ buckets: c[2] }); }}>
        {CONTENT.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        {current === "custom" && <option value="custom">Custom mix</option>}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ small parts

export function Pic({ src, size, name, ring = OV.ink }: { src?: string | null; size: string; name?: string | null; ring?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderColor: ring };
  if (!src || failed)
    return <span className="flex shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display font-extrabold"
                 style={{ ...box, background: OV.sand, color: OV.ink }} aria-hidden>{(name ?? "?").charAt(0).toUpperCase()}</span>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
              className="shrink-0 rounded-full border-[3px] object-cover" style={box} />;
}

/** A poster (2:3) with the ink outline; a big initial when there's no picture. TMDB posters come in small sizes,
 *  so a bigger box asks for a bigger file. */
export function Poster({ src, width, name, ring = OV.ink, className = "" }: { src?: string | null; width: string; name?: string | null; ring?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width, borderColor: ring };
  if (!src || failed)
    return <span className={`flex aspect-[2/3] shrink-0 items-center justify-center rounded-lg border-[3px] font-ov-display text-[28px] font-extrabold ${className}`}
                 style={{ ...box, background: OV.sand, color: OV.ink }} aria-hidden>{(name ?? "?").charAt(0).toUpperCase()}</span>;
  return <img src={src.replace("/w185/", "/w342/")} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
              className={`aspect-[2/3] shrink-0 rounded-lg border-[3px] object-cover ${className}`} style={box} />;
}

/** The picture of a channel or a show: a round face, or a poster for shows (same height as the face would be). */
export function Avatar({ src, name, size, ring }: { src?: string | null; name?: string | null; size: number; ring?: string }) {
  return useFamily() === "shows"
    ? <Poster src={src} name={name} width={`${Math.round(size * 0.78)}px`} ring={ring} className={size < 56 ? "!rounded-md !border-2 !text-[14px]" : ""} />
    : <Pic src={src} name={name} size={`${size}px`} ring={ring} />;
}

export const MOVE_COLORS: Record<Move["tone"], [string, string]> = {
  up: [OV.teal, OV.paper], new: [OV.mustard, OV.ink], down: [OV.sand, OV.ink], same: [OV.sand, OV.ink],
};

export function MoveBadge({ m }: { m: Move | null }) {
  if (!m) return null;
  const [bg, fg] = MOVE_COLORS[m.tone];
  return <span className="w-fit whitespace-nowrap rounded-full px-2 py-px font-shelf-mono text-[11px]" style={{ background: bg, color: fg }}>{m.text}</span>;
}

export const kicker = "font-shelf-mono text-[12px] uppercase tracking-[0.12em]";

export function Skeleton({ h = 120, dark = false }: { h?: number; dark?: boolean }) {
  return <div className="w-full animate-pulse rounded-xl" style={{ height: h, background: dark ? "rgba(251,246,236,0.08)" : "rgba(26,23,20,0.07)" }} />;
}

/** A section band: kicker, a headline that states the finding, an optional link, then its content. */
export function Band({ label, title, link, children }: { label: string; title: ReactNode; link?: [string, string]; children: ReactNode }) {
  const q = useLinkQuery();
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 pb-3" style={{ borderColor: OV.ink }}>
        <div className="flex flex-col gap-1">
          <span className={kicker} style={{ color: OV.soft }}>{label}</span>
          <h2 className="font-ov-display text-[clamp(26px,3vw,38px)] font-extrabold leading-tight tracking-[-0.02em]">{title}</h2>
        </div>
        {link && <Link to={link[0] + q} className="inline-flex min-h-10 items-center font-shelf-mono text-[13px] underline underline-offset-4">{link[1]} ›</Link>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ page frame

/** Every new stats page: the top bar, then the page on cream. */
export function StatsFrame({ children }: { children: ReactNode }) {
  const meta = useMeta();
  return (
    <div className="min-h-[100dvh] font-shelf-sans" style={{ background: OV.bg, color: OV.ink, colorScheme: "light" }}>
      <TopBar />
      {meta.error ? <p className="mx-auto max-w-[1400px] p-6">Can't reach your data. {meta.error.message}</p> : children}
    </div>
  );
}

/** The slim dark header of a section page: what it is, one key number, and optional controls under it. */
export function PageHeader({ label, title, children }: { label: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section style={{ background: OV.ink, color: OV.paper }}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 pb-8 pt-8 sm:px-8">
        <span className={kicker} style={{ color: OV.mustard }}>{label}</span>
        <h1 className="font-ov-display text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[1.02] tracking-[-0.02em]">{title}</h1>
        {children}
      </div>
    </section>
  );
}

/** The cream area under a page header. */
export function PageBody({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">{children}</main>;
}

/** A small segmented switch (pill buttons) for the light pages. */
export function Seg<T extends string>({ value, options, onChange, label, dark = false }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string; dark?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit flex-wrap gap-1 rounded-full border-2 p-1"
         style={{ borderColor: dark ? "#4A433B" : OV.ink }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
                className="min-h-9 rounded-full px-3.5 text-[14px] font-medium"
                style={value === v ? { background: dark ? OV.mustard : OV.ink, color: dark ? OV.ink : OV.paper }
                                   : { color: dark ? OV.paper : OV.ink }}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Where each ranked item stood in the comparison period. "This year" compares with the same dates last year
 *  (a second query); other periods use the API's previous period. undefined = nothing to compare with. */
export function usePrevRanks(kind: string, ranked: Filters): { cmp: Comparison | null; prevRank: (c: RankedItem) => number | null | undefined } {
  const { filters } = useFilters();
  const cmp = comparison(filters, useMeta().data?.today);
  const sameSpan = cmp?.start ? { ...ranked, range: "custom", start: cmp.start, end: cmp.end } : null;
  const last = useStats<TopResponse>(`top/${kind}`, { limit: 200 }, { filters: sameSpan ?? ranked, enabled: !!sameSpan });
  const prevRank = (c: RankedItem): number | null | undefined => {
    if (!cmp) return undefined;
    if (!sameSpan) return c.prev_rank;
    if (!last.data) return undefined;
    return last.data.items.find((x) => x.key === c.key)?.rank ?? null;
  };
  return { cmp, prevRank };
}

/** A row that scrolls sideways. When there's more off either edge it fades that edge and shows an arrow to page
 *  through (no arrows when it all fits). `className` goes on the scrolling box, `outer` on the wrapper. */
export function ScrollRow({ children, className = "", outer = "", bg = OV.bg }: { children: ReactNode; className?: string; outer?: string; bg?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  const page = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = (side: "left" | "right") => (
    <>
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 ${side}-0 w-14`}
            style={{ background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${bg}, ${bg}00)` }} />
      <button type="button" aria-label={side === "left" ? "Scroll left" : "Scroll right"} onClick={() => page(side === "left" ? -1 : 1)}
              className={`absolute top-1/2 ${side}-1 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-md transition-transform hover:scale-105`}
              style={{ background: OV.paper, borderColor: OV.ink, color: OV.ink }}>
        <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d={side === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
        </svg>
      </button>
    </>
  );
  return (
    <div className={`relative ${outer}`}>
      <div ref={ref} onScroll={measure} className={`no-scrollbar overflow-x-auto ${className}`}>{children}</div>
      {edges.left && arrow("left")}
      {edges.right && arrow("right")}
    </div>
  );
}
