/* The Netflix look for every Netflix page: Netflix-style top bar (transparent over the page,
   solid once you scroll), dropdown menus, search, profile square, phone tab bar and footer.
   Look-alike only: our own "W" mark, Inter instead of Netflix Sans, no Netflix assets. */
import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CalendarRange, ChevronDown, Clapperboard, Film, Home, LayoutGrid, Menu, Search, Smile, Sparkles, Trophy, X } from "lucide-react";
import { HubLink, Link, NavLink } from "../platform";
import { RankedItem, TopResponse, useMeta, useStats } from "../api";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { CustomRange } from "./RangeBar";

/** Our own mark (not Netflix's N): a red tile with a W for "Wrapped". */
export function WrappedMark({ size = 24 }: { size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-[3px] bg-yt font-black leading-none text-white"
          style={{ width: size, height: size, fontSize: size * 0.68, fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-0.04em" }}>
      W
    </span>
  );
}

export interface NavItem { to: string; label: string; end?: boolean; match?: string }
export const LINKS: NavItem[] = [
  { to: "/", label: "Home", end: true },
  { to: "/shows", label: "Shows" },
  { to: "/top/movies", label: "Movies", match: "/top/movies" },
  { to: "/top/channels", label: "Top 10", match: "/top/" },
  { to: "/patterns", label: "Patterns" },
  { to: "/records", label: "Records" },
  { to: "/evolution", label: "Evolution" },
];

/** true once the page has scrolled (the bar turns solid, like Netflix's). */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

/** Click-outside / Escape to close a menu. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

export function isActive(n: NavItem, pathname: string) {
  const rest = pathname.replace(/^\/[^/]+/, "") || "/";
  if (n.match) return n.match === "/top/" ? rest.startsWith("/top/") && !rest.startsWith("/top/movies") : rest.startsWith(n.match);
  return n.end ? rest === "/" : rest.startsWith(n.to);
}

export function NetflixShell({ children, showRange: rangeWanted = true }: { children: ReactNode; showRange?: boolean }) {
  const scrolled = useScrolled();
  const meta = useMeta();
  const q = useLinkQuery();
  const { pathname } = useLocation();
  // a show's page always covers your whole history, so the period picker would do nothing there
  const showRange = rangeWanted && !/\/channel\//.test(pathname);
  const platformName = meta.data?.platform.name ?? "Netflix";
  const isNetflix = (meta.data?.platform.id ?? "netflix") === "netflix";
  const [sheet, setSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { setSheet(false); setSearchOpen(false); }, [pathname]);

  return (
    <div className="nf flex min-h-screen flex-col">
      <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-[400ms] ${scrolled ? "bg-[#141414]" : "bg-gradient-to-b from-black/70 to-transparent"}`}>
        <div className="flex h-[56px] items-center gap-4 px-[4%] md:h-[68px] md:gap-5">
          {/* same as YouTube: the grid goes to all platforms, the name to this platform's home */}
          <HubLink to="/" aria-label="All platforms" title="All platforms"
                   className="-ml-1.5 rounded-[4px] p-1.5 text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white">
            <LayoutGrid size={21} />
          </HubLink>
          <Link to={"/" + q} aria-label={`${platformName} Wrapped home`} className="flex shrink-0 items-center gap-2">
            <WrappedMark size={26} />
            <span className="text-[19px] font-extrabold tracking-tight">{platformName} Wrapped</span>
          </Link>
          {/* full links on wide screens, a "Browse" menu between phone and desktop */}
          <nav className="hidden items-center gap-5 xl:flex" aria-label="Main">
            {LINKS.map((n) => (
              <NavLink key={n.to} to={n.to + q} end={n.end}
                       className={`text-[14px] transition-colors ${isActive(n, pathname) ? "font-bold text-white" : "text-[#e5e5e5] hover:text-[#b3b3b3]"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <BrowseMenu pathname={pathname} />
          <div className="ml-auto flex items-center gap-4">
            <TitleSearch open={searchOpen} setOpen={setSearchOpen} />
            {showRange && <div className="hidden md:block"><RangeMenu /></div>}
            <ProfileMenu />
          </div>
        </div>
        {/* phone: Netflix-app style filter pills under the bar */}
        <div className={`no-scrollbar flex gap-2 overflow-x-auto px-[4%] pb-2.5 md:hidden ${/\/top\//.test(pathname) ? "hidden" : ""}`}>
          <Link to={"/shows" + q} className={`nf-pill ${isActive(LINKS[1], pathname) ? "nf-pill-on" : ""}`}>Shows</Link>
          <Link to={"/top/movies" + q} className={`nf-pill ${isActive(LINKS[2], pathname) ? "nf-pill-on" : ""}`}>Movies</Link>
          <Link to={"/top/genres" + q} className={`nf-pill ${pathname.endsWith("/top/genres") ? "nf-pill-on" : ""}`}>Genres</Link>
          {showRange && <RangeMenu pill />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-[4%] pb-28 pt-[104px] md:pb-12 md:pt-[92px]">
        {meta.error ? (
          <div className="mt-6 text-sm">
            <p className="font-bold">Can't reach your data.</p>
            <p className="mt-1 text-[#b3b3b3]">{meta.error.message}</p>
          </div>
        ) : children}
      </main>

      <footer className="mx-auto hidden w-full max-w-[980px] px-[4%] pb-10 text-[13px] text-[#808080] md:block">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <HubLink to="/" className="hover:underline">All platforms</HubLink>
          <Link to={"/wrapped" + q} className="hover:underline">Play your Wrapped</Link>
          {isNetflix && <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer noopener" className="hover:underline">Posters and details from TMDB</a>}
        </div>
        <p className="mt-5 text-[11px]">
          Wrapped is a private, personal project made from your own viewing history. It is not affiliated with or endorsed by {platformName}.
          {isNetflix && " This product uses the TMDB API but is not endorsed or certified by TMDB."}
        </p>
      </footer>

      {/* phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 bg-[#121212] pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          <Tab to="/" end icon={Home} label="Home" active={isActive(LINKS[0], pathname)} />
          <Tab to="/shows" icon={Clapperboard} label="Shows" active={isActive(LINKS[1], pathname)} />
          <Tab to="/top/channels" icon={Trophy} label="Top 10" active={isActive(LINKS[3], pathname)} />
          <Tab to="/wrapped" icon={Sparkles} label="Wrapped" active={false} />
          <button onClick={() => setSheet((s) => !s)} aria-expanded={sheet}
                  className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] ${sheet ? "text-white" : "text-[#808080]"}`}>
            <Menu size={22} /> More
          </button>
        </div>
        {sheet && (
          <div className="absolute inset-x-0 bottom-full border-t border-white/10 bg-[#181818] px-[4%] py-2">
            {[LINKS[2], LINKS[4], LINKS[5], LINKS[6]].map((n) => (
              <Link key={n.to} to={n.to + q} className={`block py-3 text-[15px] ${isActive(n, pathname) ? "font-bold text-white" : "text-[#e5e5e5]"}`}>{n.label}</Link>
            ))}
            <HubLink to="/" className="block border-t border-white/10 py-3 text-[15px] text-[#b3b3b3]">All platforms</HubLink>
          </div>
        )}
      </nav>
    </div>
  );
}

function Tab({ to, end, icon: Icon, label, active }: { to: string; end?: boolean; icon: typeof Home; label: string; active: boolean }) {
  const q = useLinkQuery();
  return (
    <NavLink to={to + q} end={end} className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] ${active ? "text-white" : "text-[#808080]"}`}>
      <Icon size={22} fill={active && Icon === Home ? "currentColor" : "none"} /> {label}
    </NavLink>
  );
}

/** "Browse ▾" menu shown where the full link row doesn't fit. */
function BrowseMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const q = useLinkQuery();
  useEffect(() => setOpen(false), [pathname]);
  const current = LINKS.find((n) => isActive(n, pathname))?.label ?? "Browse";
  return (
    <div ref={ref} className="relative hidden md:block xl:hidden">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-[14px] font-bold">
        {current} <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="nf-menu absolute left-1/2 top-full mt-4 w-56 -translate-x-1/2 py-2">
          {LINKS.map((n) => (
            <Link key={n.to} to={n.to + q} className={`block px-4 py-2.5 text-center text-[14px] hover:bg-white/10 ${isActive(n, pathname) ? "font-bold text-white" : "text-[#b3b3b3]"}`}>
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const PRESETS: [string, string][] = [["4w", "Last 4 weeks"], ["6m", "Last 6 months"], ["this_year", "This year"], ["all", "Lifetime"]];

/** The period picker as a Netflix dropdown ("Lifetime ▾"), like its season picker. */
export function RangeMenu({ pill = false }: { pill?: boolean }) {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const close = () => { setOpen(false); setCustom(false); };
  const ref = useDismiss(open, close);
  const years = [...(meta?.years ?? [])].reverse();
  const label = filters.range === "custom" ? `${filters.start} – ${filters.end}` : PRESETS.find(([k]) => k === filters.range)?.[1] ?? rangeLabel(filters);
  const pick = (range: string) => { update({ range }); close(); };
  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Time period"
              className={pill ? `nf-pill ${open ? "nf-pill-on" : ""}` : "nf-select"}>
        {label} <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`nf-menu absolute top-full z-50 mt-2 w-60 py-1.5 ${pill ? "left-0" : "right-0"}`}>
          {custom ? (
            <div className="p-2"><CustomRange onDone={close} min={meta?.first_date} max={meta?.today} /></div>
          ) : (
            <>
              {PRESETS.map(([k, l]) => <MenuItem key={k} on={filters.range === k} onClick={() => pick(k)}>{l}</MenuItem>)}
              <div className="my-1.5 border-t border-white/15" />
              <div className="grid grid-cols-3 gap-0.5 px-1.5">
                {years.map((y) => (
                  <button key={y} onClick={() => pick(String(y))}
                          className={`rounded-[2px] px-2 py-1.5 text-[13px] hover:bg-white/10 ${filters.range === String(y) ? "bg-white font-bold text-black hover:bg-white" : "text-[#e5e5e5]"}`}>
                    {y}
                  </button>
                ))}
              </div>
              <div className="my-1.5 border-t border-white/15" />
              <MenuItem on={filters.range === "custom"} onClick={() => setCustom(true)}><CalendarRange size={15} /> Custom dates…</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] hover:bg-white/10 ${on ? "font-bold text-white" : "text-[#e5e5e5]"}`}>
      {children}
    </button>
  );
}

/** Profile square with a dropdown, like Netflix's account menu. */
export function ProfileMenu({ round = false }: { round?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const q = useLinkQuery();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu" className="flex items-center gap-1.5">
        <span className={`flex h-8 w-8 items-center justify-center bg-gradient-to-br from-[#2c6cdb] to-[#1b3f9c] ${round ? "rounded-full" : "rounded-[4px]"}`}>
          <Smile size={20} strokeWidth={2.5} />
        </span>
        <ChevronDown size={16} className={`hidden transition-transform duration-200 md:block ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="nf-menu absolute right-0 top-full mt-3 w-60 py-2 text-[13px]">
          <Link to={"/wrapped" + q} className="flex items-center gap-3 px-4 py-2 hover:underline"><Sparkles size={18} /> Play your Wrapped</Link>
          <HubLink to="/" className="flex items-center gap-3 px-4 py-2 hover:underline"><LayoutGrid size={18} /> All platforms</HubLink>
          <div className="my-2 border-t border-white/15" />
          <p className="px-4 pb-1 text-[11px] text-[#808080]">Not affiliated with {useMeta().data?.platform.name ?? "Netflix"}</p>
        </div>
      )}
    </div>
  );
}

/** Search your shows and movies (everything you've watched), Netflix-style expanding box. */
export function TitleSearch({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const [text, setText] = useState("");
  const ref = useDismiss(open, () => setOpen(false));
  const q = useLinkQuery();
  const lifetime = { ...useFilters().filters, range: "all", start: undefined, end: undefined };
  const shows = useStats<TopResponse>("top/channels", { limit: 1000 }, { enabled: open, filters: lifetime });
  const movies = useStats<TopResponse>("top/movies", { limit: 1000 }, { enabled: open, filters: lifetime });
  const needle = text.trim().toLowerCase();
  const hits: (RankedItem & { kind: "show" | "movie" })[] = needle
    ? [...(shows.data?.items ?? []).map((i) => ({ ...i, kind: "show" as const })),
       ...(movies.data?.items ?? []).map((i) => ({ ...i, kind: "movie" as const }))]
        .filter((i) => (i.title ?? "").toLowerCase().includes(needle)).slice(0, 8)
    : [];
  return (
    <div ref={ref} className="relative">
      {open ? (
        <div className="flex items-center gap-2 border border-white bg-black/75 px-2 py-1.5">
          <Search size={20} />
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Shows, movies"
                 className="w-[46vw] max-w-[240px] bg-transparent text-[14px] text-white outline-none placeholder:text-[#8c8c8c]" />
          <button onClick={() => { setText(""); setOpen(false); }} aria-label="Close search"><X size={18} /></button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} aria-label="Search your titles" className="flex items-center"><Search size={22} /></button>
      )}
      {open && needle && (
        <div className="nf-menu absolute right-0 top-full mt-2 w-[min(90vw,340px)] py-1.5">
          {hits.length ? hits.map((h) => (
            <Link key={h.kind + h.key} to={(h.kind === "show" ? `/channel/${h.key}` : `/video/${h.key}`) + q}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-white/10">
              {h.avatar_url ?? h.thumb
                ? <img src={(h.avatar_url ?? h.thumb)!} alt="" className="h-12 w-8 shrink-0 rounded-[2px] object-cover" />
                : <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded-[2px] bg-[#2f2f2f]"><Film size={14} /></span>}
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{h.title}</span>
                <span className="text-[12px] text-[#b3b3b3]">{h.kind === "show" ? `Show · ${h.count} episode${h.count === 1 ? "" : "s"}` : "Movie"}</span>
              </span>
            </Link>
          )) : <p className="px-4 py-3 text-[13px] text-[#b3b3b3]">{shows.isLoading ? "Searching…" : `Nothing you've watched matches "${text}".`}</p>}
        </div>
      )}
    </div>
  );
}
