/* The frame around every page of a shows platform (Netflix, Crunchyroll, Prime Video…): top bar with
   nav, search, period picker and profile menu; phone quick filters and tab bar; footer.
   One component; the platform's look (bar style, nav style, icons, colors, credits) comes from
   its theme's ShellLook (themes.tsx). Look-alike only: our own "W" mark, free fonts, no platform assets. */
import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CalendarRange, ChevronDown, Film, LayoutGrid, Search, Smile, Sparkles, X } from "lucide-react";
import { HubLink, Link, NavLink, useTheme } from "../platform";
import { RankedItem, TopResponse, useMeta, useStats } from "../api";
import { rangeLabel, useFilters, useLinkQuery } from "../filters";
import { CustomRange } from "./RangeBar";
import { KindSplit, useShows } from "./shows";
import type { ShellLook, TabName } from "../themes";

/** Our own mark (no platform's logo): a tile in the accent color with a W for "Wrapped". */
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
const [HOME, SHOWS, MOVIES, TOP] = LINKS;
const GENRES: NavItem = { to: "/top/genres", label: "Genres" };
const TABS: [TabName, NavItem | null, string][] = [["home", HOME, "Home"], ["shows", SHOWS, "Shows"], ["top", TOP, "Top 10"], ["wrapped", null, "Wrapped"]];

/** true once the page has scrolled (an overlay bar turns solid). */
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

export function ShowsShell({ children, showRange: rangeWanted = true }: { children: ReactNode; showRange?: boolean }) {
  const look = useTheme().shell!;
  const scrolled = useScrolled();
  const meta = useMeta();
  const q = useLinkQuery();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { setSheet(false); setSearchOpen(false); }, [pathname]);
  // a show's page always covers your whole history, so the period picker would do nothing there
  const showRange = rangeWanted && !/\/channel\//.test(pathname);
  const platformName = meta.data?.platform.name ?? "Netflix";

  // nav: the shared links, the theme's extra ones (e.g. Anime) after Shows, Movies only if there are any
  const split = useShows<KindSplit>("split", { range: "all" }, !look.moviesOnlyIfAny);
  const hasMovies = !look.moviesOnlyIfAny || (split.data?.data.movie.count ?? 0) > 0;
  const links = LINKS.filter((n) => n !== MOVIES || hasMovies);
  links.splice(2, 0, ...look.extraLinks);
  const inSheet = links.filter((n) => !TABS.some(([, t]) => t === n));
  const pillItem = (id: string) => ({ shows: SHOWS, movies: MOVIES, top: TOP, genres: GENRES }[id] ?? look.extraLinks.find((n) => n.to === `/${id}`)!);
  const pillOn = (n: NavItem) => (n === GENRES ? pathname.endsWith("/top/genres") : isActive(n, pathname));
  const tiles = look.nav === "tiles";

  return (
    <div className={`${look.root} flex min-h-screen flex-col`}>
      <header className={look.header(scrolled)}>
        <div className={look.bar}>
          {/* the grid goes to all platforms, the name to this platform's home */}
          <HubLink to="/" aria-label="All platforms" title="All platforms" className={look.hubLink}>{look.hubIcon}</HubLink>
          <Link to={"/" + q} aria-label={`${platformName} Wrapped home`} className={look.logoLink}>
            <WrappedMark size={look.markSize} />
            <span className={look.title}>{platformName} Wrapped</span>
          </Link>
          {tiles ? (
            <nav className="ml-2 hidden items-stretch xl:flex" aria-label="Main">
              {links.map((n) => <NavTile key={n.to} n={n} active={isActive(n, pathname)} look={look} />)}
            </nav>
          ) : (
            <>
              {/* full links on wide screens, a "Browse" menu between phone and desktop */}
              <nav className="hidden items-center gap-5 xl:flex" aria-label="Main">
                {links.map((n) => (
                  <NavLink key={n.to} to={n.to + q} end={n.end}
                           className={`text-[14px] transition-colors ${isActive(n, pathname) ? "font-bold text-white" : "text-[#e5e5e5] hover:text-[#b3b3b3]"}`}>
                    {n.label}
                  </NavLink>
                ))}
              </nav>
              <BrowseMenu pathname={pathname} links={links} />
            </>
          )}
          {tiles ? (
            <div className="ml-auto flex items-stretch">
              <div className="flex items-center px-3"><TitleSearch open={searchOpen} setOpen={setSearchOpen} /></div>
              {showRange && <div className="hidden items-center px-2 md:flex"><RangeMenu /></div>}
              <div className="flex items-center px-3"><ProfileMenu round={look.roundProfile} /></div>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-4">
              <TitleSearch open={searchOpen} setOpen={setSearchOpen} />
              {showRange && <div className="hidden md:block"><RangeMenu /></div>}
              <ProfileMenu round={look.roundProfile} />
            </div>
          )}
        </div>
        {/* tiles between phone and desktop: the nav as a strip under the bar */}
        {tiles && (
          <nav className="no-scrollbar hidden overflow-x-auto border-t border-black/40 bg-[#272727] px-[2%] md:flex xl:hidden" aria-label="Sections">
            {links.map((n) => <NavTile key={n.to} n={n} active={isActive(n, pathname)} look={look} compact />)}
          </nav>
        )}
        {/* phone: quick filters under the bar (the Top page has its own tabs) */}
        <div className={`${look.pillsBar} ${/\/top\//.test(pathname) ? "hidden" : ""}`}>
          {look.pills.map((id) => {
            const n = pillItem(id);
            return <Link key={id} to={n.to + q} className={`nf-pill ${pillOn(n) ? "nf-pill-on" : ""}`}>{n.label}</Link>;
          })}
          {showRange && <RangeMenu pill />}
        </div>
      </header>

      <main className={look.main}>
        {meta.error ? (
          <div className="mt-6 text-sm">
            <p className="font-bold">Can't reach your data.</p>
            <p className={`mt-1 ${look.subText}`}>{meta.error.message}</p>
          </div>
        ) : children}
      </main>

      <Footer look={look} platformName={platformName} />

      {/* phone tab bar */}
      <nav className={look.tabs.bar} aria-label="Main">
        <div className="grid grid-cols-5">
          {TABS.map(([name, n, label]) => (
            <NavLink key={name} to={(n?.to ?? "/wrapped") + q} end={n?.end}
                     className={`${look.tabs.tab} ${n && isActive(n, pathname) ? look.tabs.on : look.tabs.off}`}>
              {look.tabs.icon(name, !!n && isActive(n, pathname))} {label}
            </NavLink>
          ))}
          <button onClick={() => setSheet((s) => !s)} aria-expanded={sheet}
                  className={`${look.tabs.tab} ${sheet ? look.tabs.on : look.tabs.off}`}>
            {look.tabs.icon("more", sheet)} More
          </button>
        </div>
        {sheet && (
          <div className={look.tabs.sheet}>
            {inSheet.map((n) => (
              <Link key={n.to} to={n.to + q} className={`block py-3 text-[15px] ${isActive(n, pathname) ? look.tabs.sheetOn : look.tabs.sheetOff}`}>{n.label}</Link>
            ))}
            <HubLink to="/" className={look.tabs.sheetHub}>All platforms</HubLink>
          </div>
        )}
      </nav>
    </div>
  );
}

function Footer({ look, platformName }: { look: ShellLook; platformName: string }) {
  const q = useLinkQuery();
  const f = look.footer;
  const body = (
    <>
      <div className={f.links}>
        <HubLink to="/" className={f.link}>All platforms</HubLink>
        <Link to={"/wrapped" + q} className={f.link}>Play your Wrapped</Link>
        {f.credits.map((c) => <a key={c.href} href={c.href} target="_blank" rel="noreferrer noopener" className={f.link}>{c.label}</a>)}
      </div>
      <p className={f.note}>
        Wrapped is a private, personal project made from your own viewing history. It is not affiliated with or endorsed by {platformName}.
        {f.extraNote}
      </p>
    </>
  );
  return <footer className={f.outer}>{f.inner ? <div className={f.inner}>{body}</div> : body}</footer>;
}

/** Full-height nav tile (tile-style bars): gray text, white on a darker tile when hovered or active. */
function NavTile({ n, active, look, compact = false }: { n: NavItem; active: boolean; look: ShellLook; compact?: boolean }) {
  const q = useLinkQuery();
  return (
    <NavLink to={n.to + q} end={n.end}
             className={`relative flex items-center whitespace-nowrap px-4 text-[14px] font-medium transition-colors duration-100 ${compact ? "h-11" : ""} ${
               active ? "bg-[#151515] text-white" : "text-[#bbb] hover:bg-[#151515] hover:text-white"}`}>
      {n.label}
      {active && <span className={`absolute inset-x-0 bottom-0 h-[3px] ${look.tileAccent}`} aria-hidden />}
    </NavLink>
  );
}

/** "Browse ▾" menu shown where the full link row doesn't fit. */
function BrowseMenu({ pathname, links }: { pathname: string; links: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const q = useLinkQuery();
  useEffect(() => setOpen(false), [pathname]);
  const current = links.find((n) => isActive(n, pathname))?.label ?? "Browse";
  return (
    <div ref={ref} className="relative hidden md:block xl:hidden">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-[14px] font-bold">
        {current} <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="nf-menu absolute left-1/2 top-full mt-4 w-56 -translate-x-1/2 py-2">
          {links.map((n) => (
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

/** The period picker as a dropdown ("Lifetime ▾"), like a season picker. */
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

/** Profile square (or circle) with a dropdown, like a streaming service's account menu. */
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

/** Search your shows and movies (everything you've watched), with an expanding box. */
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
