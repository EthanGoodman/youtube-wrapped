import { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { HubLink, Link, NavLink, usePlatform } from "../platform";
import { BarChart3, Film, Clock, Home, LayoutGrid, Megaphone, MoreHorizontal, Search, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { useLinkQuery } from "../filters";
import { useMeta } from "../api";
import { RangeBar } from "./RangeBar";
import { NetflixShell } from "./NetflixShell";

interface NavItem { to: string; label: string; icon: typeof Home; end?: boolean; match?: string; cap?: string }
const ALL_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/top/channels", label: "Top", icon: BarChart3, match: "/top/" },
  { to: "/shows", label: "Shows", icon: Film, cap: "series" },
  { to: "/patterns", label: "Patterns", icon: Clock },
  { to: "/records", label: "Records", icon: Trophy },
  { to: "/evolution", label: "Evolution", icon: TrendingUp },
  { to: "/ads", label: "Ads", icon: Megaphone, cap: "ads" },
  { to: "/search", label: "Search", icon: Search, cap: "search" },
];

export function Logo() {
  const p = usePlatform();
  const name = p?.name ?? "YouTube";
  return (
    <span className="flex items-center gap-1.5 font-bold tracking-tight">
      {(p?.id ?? "youtube") === "youtube" ? (
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
          <rect x="2" y="7" width="28" height="18" rx="6" fill="#ff0033" />
          <path d="M13 11.5v9l8-4.5z" fill="#fff" />
        </svg>
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-yt font-display text-2xl leading-none text-white" aria-hidden>
          {name.charAt(0)}
        </span>
      )}
      <span className="text-lg">
        {p?.theme === "netflix"
          ? <span className="font-display text-2xl tracking-wide text-yt">{name.toUpperCase()} <span className="text-ink">WRAPPED</span></span>
          : <>{name} <span className="font-black">Wrapped</span></>}
      </span>
    </span>
  );
}

export function Layout({ children, showRange = true }: { children: ReactNode; showRange?: boolean }) {
  // Netflix gets its own frame (top bar, menus, phone tabs) so it feels like Netflix, not a recolored YouTube
  if (usePlatform()?.theme === "netflix") return <NetflixShell showRange={showRange}>{children}</NetflixShell>;
  return <DefaultLayout showRange={showRange}>{children}</DefaultLayout>;
}

function DefaultLayout({ children, showRange = true }: { children: ReactNode; showRange?: boolean }) {
  const q = useLinkQuery();
  const meta = useMeta();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const caps = meta.data?.platform.capabilities;
  // until meta loads, show everything (YouTube) so the bar doesn't jump
  const NAV = ALL_NAV.filter((n) => !n.cap || !caps || caps.includes(n.cap));
  const MOBILE_MAIN = NAV.slice(0, 4);
  const MOBILE_MORE = NAV.slice(4);

  return (
    <div className="min-h-screen pb-24 sm:pb-10">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <HubLink to="/" aria-label="All platforms" title="All platforms"
                   className="-ml-1 rounded-lg p-1.5 text-sub transition-colors hover:bg-raised hover:text-ink">
            <LayoutGrid size={20} />
          </HubLink>
          <Link to={"/" + q} aria-label="Home"><Logo /></Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to + q} end={n.end}
                       className={({ isActive }) =>
                         `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                           isActive || (n.match && pathname.includes(n.match)) ? "bg-raised text-ink" : "text-sub hover:text-ink"
                         }`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Link to={"/wrapped" + q}
                className="ml-auto flex items-center gap-1.5 rounded-full bg-yt px-3.5 py-1.5 text-sm font-bold text-white hover:bg-yt-dark">
            <Sparkles size={15} /> Wrapped
          </Link>
        </div>
        {showRange && (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <RangeBar />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-4">
        {meta.error ? (
          <div className="card mt-6 text-sm">
            <p className="font-bold">Can't reach your data.</p>
            <p className="mt-1 text-sub">{meta.error.message}</p>
          </div>
        ) : (
          children
        )}
      </main>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
           aria-label="Main">
        <div className="grid grid-cols-5">
          {MOBILE_MAIN.map((n) => (
            <NavLink key={n.to} to={n.to + q} end={n.end} onClick={() => setMore(false)}
                     className={({ isActive }) =>
                       `flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                         isActive || (n.match && pathname.includes(n.match)) ? "text-ink" : "text-muted"
                       }`}>
              <n.icon size={22} />
              {n.label}
            </NavLink>
          ))}
          <button onClick={() => setMore((m) => !m)} aria-expanded={more}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${more ? "text-ink" : "text-muted"}`}>
            <MoreHorizontal size={22} />
            More
          </button>
        </div>
        {more && (
          <div className="absolute bottom-full right-2 mb-2 w-48 rounded-xl border border-line bg-[#282828] p-1 shadow-2xl">
            {MOBILE_MORE.map((n) => (
              <NavLink key={n.to} to={n.to + q} onClick={() => setMore(false)}
                       className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-raised">
                <n.icon size={18} /> {n.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>
    </div>
  );
}
