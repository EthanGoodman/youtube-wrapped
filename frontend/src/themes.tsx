/* One config per platform: everything that makes it look like itself, in one place.
   Pages come from the platform's family (videos: YouTube; shows: Netflix, Crunchyroll, Prime Video…);
   a theme only picks colors, marks and a few variants, so a new platform of an existing family
   needs a config here (and its CSS colors in index.css), not new page components.
   Design rules for a new theme: see CONTRIBUTING.md ("Designing a platform"). */
import { ReactNode } from "react";
import { Clapperboard, Home, LayoutGrid, Menu, Sparkles, Trophy } from "lucide-react";
import { House, List, Sparkle, SquaresFour, Television, Trophy as PTrophy } from "@phosphor-icons/react";
import { PlatformInfo } from "./platform";
import { NavItem, WrappedMark } from "./components/ShowsShell";
import { YtMark } from "./wrapped/cards";

export type Family = "videos" | "shows";

export interface WrappedLook {
  mark: (size: number) => ReactNode;  // small logo on the year picker and story cards
  pickerBg: string;                     // year picker background
  tiles: string[];                      // year tile gradients, in order
  backdrop: string;                     // glow behind the story player
  tileFont?: string;
}

export type TabName = "home" | "shows" | "top" | "wrapped" | "more";

/** How a shows platform's frame looks (ShowsShell). Class strings are Tailwind. */
export interface ShellLook {
  root: string;                               // classes on the outermost element (theme CSS hooks)
  header: (scrolled: boolean) => string;      // the top bar; may change once the page scrolls
  bar: string;                                // the row inside it
  nav: "links" | "tiles";                     // text links + Browse menu, or full-height tiles
  hubLink: string;
  hubIcon: ReactNode;
  logoLink: string;
  title: string;
  markSize: number;
  roundProfile: boolean;
  tileAccent: string;                         // tiles: the bar under the active one
  extraLinks: NavItem[];                      // after Shows, e.g. Anime
  moviesOnlyIfAny: boolean;                   // hide Movies when the history has none
  pillsBar: string;                           // phone quick filters
  pills: string[];                            // shows | movies | top | genres | an extra link's path
  main: string;
  subText: string;
  footer: { outer: string; inner?: string; links: string; link: string; note: string;
            credits: { href: string; label: string }[]; extraNote?: string };
  tabs: { bar: string; tab: string; on: string; off: string; icon: (name: TabName, active: boolean) => ReactNode;
          sheet: string; sheetOn: string; sheetOff: string; sheetHub: string };
}

const NETFLIX_TABS = { home: Home, shows: Clapperboard, top: Trophy, wrapped: Sparkles, more: Menu };
/** Netflix-like: a bar that's transparent over the page and turns solid when you scroll, text links. */
export const NETFLIX_LOOK: ShellLook = {
  root: "nf",
  header: (scrolled) => `fixed inset-x-0 top-0 z-40 transition-colors duration-[400ms] ${scrolled ? "bg-[#141414]" : "bg-gradient-to-b from-black/70 to-transparent"}`,
  bar: "flex h-[56px] items-center gap-4 px-[4%] md:h-[68px] md:gap-5",
  nav: "links",
  hubLink: "-ml-1.5 rounded-[4px] p-1.5 text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white",
  hubIcon: <LayoutGrid size={21} />,
  logoLink: "flex shrink-0 items-center gap-2",
  title: "text-[19px] font-extrabold tracking-tight",
  markSize: 26,
  roundProfile: false,
  tileAccent: "bg-yt",
  extraLinks: [],
  moviesOnlyIfAny: false,
  pillsBar: "no-scrollbar flex gap-2 overflow-x-auto px-[4%] pb-2.5 md:hidden",
  pills: ["shows", "movies", "genres"],
  main: "mx-auto w-full max-w-[1600px] flex-1 px-[4%] pb-28 pt-[104px] md:pb-12 md:pt-[92px]",
  subText: "text-[#b3b3b3]",
  footer: {
    outer: "mx-auto hidden w-full max-w-[980px] px-[4%] pb-10 text-[13px] text-[#808080] md:block",
    links: "flex flex-wrap gap-x-8 gap-y-2", link: "hover:underline", note: "mt-5 text-[11px]", credits: [],
  },
  tabs: {
    bar: "fixed inset-x-0 bottom-0 z-40 bg-[#121212] pb-[env(safe-area-inset-bottom)] md:hidden",
    tab: "flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px]", on: "text-white", off: "text-[#808080]",
    icon: (name, active) => {
      const I = NETFLIX_TABS[name];
      return name === "more" ? <I size={22} /> : <I size={22} fill={active && name === "home" ? "currentColor" : "none"} />;
    },
    sheet: "absolute inset-x-0 bottom-full border-t border-white/10 bg-[#181818] px-[4%] py-2",
    sheetOn: "font-bold text-white", sheetOff: "text-[#e5e5e5]",
    sheetHub: "block border-t border-white/10 py-3 text-[15px] text-[#b3b3b3]",
  },
};

const TMDB_CREDIT = {
  credits: [{ href: "https://www.themoviedb.org", label: "Posters and details from TMDB" }],
  extraNote: " This product uses the TMDB API but is not endorsed or certified by TMDB.",
};

const CR_TABS = { home: House, shows: Television, top: PTrophy, wrapped: Sparkle, more: List };
/** Crunchyroll-like: a solid dark bar with full-height nav tiles, square corners, filled icons. */
export const CRUNCHYROLL_LOOK: ShellLook = {
  root: "nf cr",
  header: () => "fixed inset-x-0 top-0 z-40 bg-[#272727] shadow-[0_2px_8px_rgba(0,0,0,.4)]",
  bar: "mx-auto flex h-[60px] max-w-[1600px] items-stretch px-[2%] md:h-[72px]",
  nav: "tiles",
  hubLink: "flex items-center px-3 text-[#bbb] transition-colors duration-100 hover:bg-[#151515] hover:text-white",
  hubIcon: <SquaresFour size={24} weight="fill" />,
  logoLink: "flex shrink-0 items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-[#151515]",
  title: "cr-display text-[19px] font-extrabold tracking-[-0.02em]",
  markSize: 28,
  roundProfile: true,
  tileAccent: "bg-[#ff640a]",
  extraLinks: [{ to: "/anime", label: "Anime" }],
  moviesOnlyIfAny: true,
  pillsBar: "no-scrollbar flex gap-2 overflow-x-auto bg-[#000] px-[4%] py-2 md:hidden",
  pills: ["shows", "anime", "top", "genres"],
  main: "mx-auto w-full max-w-[1600px] flex-1 px-[4%] pb-28 pt-[124px] md:pb-14 md:pt-[144px] xl:pt-[100px]",
  subText: "text-[#bbb]",
  footer: {
    outer: "hidden w-full bg-gradient-to-b from-black to-[#213944] md:block",
    inner: "mx-auto max-w-[1200px] px-[4%] pb-12 pt-16 text-[14px] text-[#bbb]",
    links: "flex flex-wrap gap-x-10 gap-y-2", link: "text-[#2abdbb] hover:text-white", note: "mt-6 text-[12px] text-[#8c8c8c]",
    credits: [{ href: "https://anilist.co", label: "Studios and seasons from AniList" }],
  },
  tabs: {
    bar: "fixed inset-x-0 bottom-0 z-40 border-t border-[#272727] bg-black pb-[env(safe-area-inset-bottom)] md:hidden",
    tab: "flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] font-medium uppercase tracking-wide",
    on: "text-[#ff640a]", off: "text-[#8c8c8c]",
    icon: (name) => { const I = CR_TABS[name]; return <I size={24} weight="fill" />; },
    sheet: "absolute inset-x-0 bottom-full bg-[#272727] px-[4%] py-1",
    sheetOn: "font-bold text-[#ff640a]", sheetOff: "text-white",
    sheetHub: "block border-t border-black/40 py-3 text-[15px] text-[#bbb]",
  },
};

export interface PlatformTheme {
  family: Family;
  /** creators pictured as round avatars (channels) or 2:3 posters (shows) */
  creatorShape: "circle" | "poster";
  /** hub and Data sources tile */
  tile: { bg: string; fg?: string };
  wrapped: WrappedLook;
  /** shows family: use the anime layouts (home rows, show page, poster cards) instead of the default ones */
  anime?: boolean;
  /** shows family: the frame around every page (videos platforms use the default layout) */
  shell?: ShellLook;
}

const YOUTUBE_WRAPPED: WrappedLook = {
  mark: (size) => <YtMark size={size} />,
  pickerBg: "radial-gradient(ellipse at top,#4a0012,#0f0f0f 60%)",
  tiles: ["#ff0033", "#7c3aed", "#f97316", "#0ea5e9", "#db2777", "#10b981"],
  backdrop: "radial-gradient(circle at 30% 30%, #ff0033, transparent 55%), radial-gradient(circle at 70% 70%, #7c3aed, transparent 55%)",
};

/** Wrapped look for a shows platform, from its brand color and a dark shade of it. */
function showsWrapped(bright: string, mid: string, deep: string, darker: string, bg: string): WrappedLook {
  return {
    mark: (size) => <WrappedMark size={size} />,
    pickerBg: `radial-gradient(ellipse at top,${darker},${bg} 60%)`,
    tiles: [bright, mid, deep, darker, bright, mid],
    backdrop: `radial-gradient(circle at 30% 30%, ${bright}, transparent 55%), radial-gradient(circle at 70% 70%, ${darker}, transparent 55%)`,
    tileFont: "Inter, sans-serif",
  };
}

export const THEMES: Record<string, PlatformTheme> = {
  youtube: {
    family: "videos", creatorShape: "circle",
    tile: { bg: "linear-gradient(140deg,#ff0033,#7a0019)" },
    wrapped: YOUTUBE_WRAPPED,
  },
  netflix: {
    family: "shows", creatorShape: "poster",
    tile: { bg: "linear-gradient(140deg,#e50914,#3d0306)" },
    wrapped: showsWrapped("#e50914", "#b20710", "#831010", "#5c0a0f", "#0b0b0b"),
    shell: { ...NETFLIX_LOOK, footer: { ...NETFLIX_LOOK.footer, ...TMDB_CREDIT } },
  },
  crunchyroll: {
    family: "shows", creatorShape: "poster", anime: true,
    tile: { bg: "linear-gradient(140deg,#ff640a,#7a2a05)" },
    wrapped: showsWrapped("#f47521", "#c85a12", "#8a3d0c", "#5a2a0b", "#000"),
    shell: CRUNCHYROLL_LOOK,
  },
  // planned platforms: hub tiles for now; their family config comes with their connector
  spotify: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#1ed760,#0b5c2a)", fg: "#0b0b0b" }, wrapped: YOUTUBE_WRAPPED },
  prime_video: { family: "shows", creatorShape: "poster", tile: { bg: "linear-gradient(140deg,#00a8e1,#0b2a4a)" }, wrapped: showsWrapped("#00a8e1", "#0a7fb0", "#0b4f75", "#0b2a4a", "#05080d"), shell: NETFLIX_LOOK },
  tiktok: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#25f4ee 0%,#111 45%,#fe2c55 100%)" }, wrapped: YOUTUBE_WRAPPED },
  instagram: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#f58529,#dd2a7b 50%,#8134af)" }, wrapped: YOUTUBE_WRAPPED },
};

const DEFAULT_VIDEOS = THEMES.youtube;
const DEFAULT_SHOWS: PlatformTheme = {
  family: "shows", creatorShape: "poster",
  tile: { bg: "linear-gradient(140deg,rgb(var(--c-accent)),#111)" },
  wrapped: showsWrapped("#e50914", "#b20710", "#831010", "#5c0a0f", "#0b0b0b"),
  shell: NETFLIX_LOOK,
};

/** The theme for a platform. Unknown ones get their family's default (shows if they have series). */
export function themeOf(p: Pick<PlatformInfo, "id" | "theme" | "capabilities"> | null | undefined): PlatformTheme {
  if (!p) return DEFAULT_VIDEOS;
  return THEMES[p.theme] ?? THEMES[p.id] ?? (p.capabilities.includes("series") ? DEFAULT_SHOWS : DEFAULT_VIDEOS);
}

/** Tile look by id alone (hub, Data sources), before platform details load. */
export function tileOf(id: string): PlatformTheme["tile"] {
  return THEMES[id]?.tile ?? { bg: "rgb(var(--c-raised))" };
}
