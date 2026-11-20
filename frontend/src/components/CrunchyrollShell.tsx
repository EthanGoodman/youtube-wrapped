/* The Crunchyroll look for every Crunchyroll page: a solid dark-gray top bar with full-height nav
   tiles, square corners, uppercase buttons, filled icons, a footer that fades to dark teal, and a phone
   tab bar. Look-alike only: our own "W" mark, free fonts (DM Sans, Bricolage Grotesque), no Crunchyroll
   logo, eye mark or mascot. */
import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { House, List, Sparkle, SquaresFour, Television, Trophy } from "@phosphor-icons/react";
import { HubLink, Link, NavLink } from "../platform";
import { useMeta } from "../api";
import { useLinkQuery } from "../filters";
import { KindSplit, useShows } from "./shows";
import { LINKS, NavItem, ProfileMenu, RangeMenu, TitleSearch, WrappedMark, isActive } from "./NetflixShell";

const ANIME: NavItem = { to: "/anime", label: "Anime" };

export function CrunchyrollShell({ children, showRange: rangeWanted = true }: { children: ReactNode; showRange?: boolean }) {
  const meta = useMeta();
  const q = useLinkQuery();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { setSheet(false); setSearchOpen(false); }, [pathname]);
  // a show's page always covers your whole history, so the period picker would do nothing there
  const showRange = rangeWanted && !/\/channel\//.test(pathname);
  const onTop = /\/top\//.test(pathname);
  // anime history is nearly all series: only show Movies when there are some
  const split = useShows<KindSplit>("split", { range: "all" });
  const hasMovies = (split.data?.data.movie.count ?? 0) > 0;
  const links = LINKS.filter((n) => n.to !== "/top/movies" || hasMovies);
  links.splice(2, 0, ANIME);

  return (
    <div className="nf cr flex min-h-screen flex-col">
      <header className="fixed inset-x-0 top-0 z-40 bg-[#272727] shadow-[0_2px_8px_rgba(0,0,0,.4)]">
        <div className="mx-auto flex h-[60px] max-w-[1600px] items-stretch px-[2%] md:h-[72px]">
          <HubLink to="/" aria-label="All platforms" title="All platforms"
                   className="flex items-center px-3 text-[#bbb] transition-colors duration-100 hover:bg-[#151515] hover:text-white">
            <SquaresFour size={24} weight="fill" />
          </HubLink>
          <Link to={"/" + q} aria-label="Crunchyroll Wrapped home"
                className="flex shrink-0 items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-[#151515]">
            <WrappedMark size={28} />
            <span className="cr-display text-[19px] font-extrabold tracking-[-0.02em]">Crunchyroll Wrapped</span>
          </Link>
          <nav className="ml-2 hidden items-stretch xl:flex" aria-label="Main">
            {links.map((n) => <NavTile key={n.to} n={n} active={isActive(n, pathname)} />)}
          </nav>
          <div className="ml-auto flex items-stretch">
            <div className="flex items-center px-3"><TitleSearch open={searchOpen} setOpen={setSearchOpen} /></div>
            {showRange && <div className="hidden items-center px-2 md:flex"><RangeMenu /></div>}
            <div className="flex items-center px-3"><ProfileMenu round /></div>
          </div>
        </div>
        {/* below the bar between phone and desktop: the nav as a strip of tiles */}
        <nav className="no-scrollbar hidden overflow-x-auto border-t border-black/40 bg-[#272727] px-[2%] md:flex xl:hidden" aria-label="Sections">
          {links.map((n) => <NavTile key={n.to} n={n} active={isActive(n, pathname)} compact />)}
        </nav>
        {/* phone: quick filters under the bar (the Top page has its own tabs) */}
        <div className={`no-scrollbar flex gap-2 overflow-x-auto bg-[#000] px-[4%] py-2 md:hidden ${onTop ? "hidden" : ""}`}>
          <Link to={"/shows" + q} className={`nf-pill ${isActive(LINKS[1], pathname) ? "nf-pill-on" : ""}`}>Shows</Link>
          <Link to={"/anime" + q} className={`nf-pill ${isActive(ANIME, pathname) ? "nf-pill-on" : ""}`}>Anime</Link>
          <Link to={"/top/channels" + q} className={`nf-pill ${isActive(LINKS[3], pathname) ? "nf-pill-on" : ""}`}>Top 10</Link>
          <Link to={"/top/genres" + q} className={`nf-pill ${pathname.endsWith("/top/genres") ? "nf-pill-on" : ""}`}>Genres</Link>
          {showRange && <RangeMenu pill />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-[4%] pb-28 pt-[124px] md:pb-14 md:pt-[144px] xl:pt-[100px]">
        {meta.error ? (
          <div className="mt-6 text-sm">
            <p className="font-bold">Can't reach your data.</p>
            <p className="mt-1 text-[#bbb]">{meta.error.message}</p>
          </div>
        ) : children}
      </main>

      <footer className="hidden w-full bg-gradient-to-b from-black to-[#213944] md:block">
        <div className="mx-auto max-w-[1200px] px-[4%] pb-12 pt-16 text-[14px] text-[#bbb]">
          <div className="flex flex-wrap gap-x-10 gap-y-2">
            <HubLink to="/" className="text-[#2abdbb] hover:text-white">All platforms</HubLink>
            <Link to={"/wrapped" + q} className="text-[#2abdbb] hover:text-white">Play your Wrapped</Link>
            <a href="https://anilist.co" target="_blank" rel="noreferrer noopener" className="text-[#2abdbb] hover:text-white">Studios and seasons from AniList</a>
          </div>
          <p className="mt-6 text-[12px] text-[#8c8c8c]">
            Wrapped is a private, personal project made from your own viewing history. It is not affiliated with or endorsed by Crunchyroll.
          </p>
        </div>
      </footer>

      {/* phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#272727] bg-black pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          <Tab to="/" end icon={House} label="Home" active={isActive(LINKS[0], pathname)} />
          <Tab to="/shows" icon={Television} label="Shows" active={isActive(LINKS[1], pathname)} />
          <Tab to="/top/channels" icon={Trophy} label="Top 10" active={isActive(LINKS[3], pathname)} />
          <Tab to="/wrapped" icon={Sparkle} label="Wrapped" active={false} />
          <button onClick={() => setSheet((s) => !s)} aria-expanded={sheet}
                  className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] font-medium uppercase tracking-wide ${sheet ? "text-[#ff640a]" : "text-[#8c8c8c]"}`}>
            <List size={24} weight="fill" /> More
          </button>
        </div>
        {sheet && (
          <div className="absolute inset-x-0 bottom-full bg-[#272727] px-[4%] py-1">
            {[ANIME, LINKS[2], LINKS[4], LINKS[5], LINKS[6]].filter((n) => links.includes(n)).map((n) => (
              <Link key={n.to} to={n.to + q} className={`block py-3 text-[15px] ${isActive(n, pathname) ? "font-bold text-[#ff640a]" : "text-white"}`}>{n.label}</Link>
            ))}
            <HubLink to="/" className="block border-t border-black/40 py-3 text-[15px] text-[#bbb]">All platforms</HubLink>
          </div>
        )}
      </nav>
    </div>
  );
}

/** Full-height nav tile, as on Crunchyroll's bar: gray text, white on a darker tile when hovered or active. */
function NavTile({ n, active, compact = false }: { n: NavItem; active: boolean; compact?: boolean }) {
  const q = useLinkQuery();
  return (
    <NavLink to={n.to + q} end={n.end}
             className={`relative flex items-center whitespace-nowrap px-4 text-[14px] font-medium transition-colors duration-100 ${compact ? "h-11" : ""} ${
               active ? "bg-[#151515] text-white" : "text-[#bbb] hover:bg-[#151515] hover:text-white"}`}>
      {n.label}
      {active && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#ff640a]" aria-hidden />}
    </NavLink>
  );
}

function Tab({ to, end, icon: Icon, label, active }: { to: string; end?: boolean; icon: typeof House; label: string; active: boolean }) {
  const q = useLinkQuery();
  return (
    <NavLink to={to + q} end={end}
             className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] font-medium uppercase tracking-wide ${active ? "text-[#ff640a]" : "text-[#8c8c8c]"}`}>
      <Icon size={24} weight="fill" /> {label}
    </NavLink>
  );
}
