/* One config per platform: everything that makes it look like itself, in one place.
   Pages come from the platform's family (videos: YouTube; shows: Netflix, Crunchyroll, Prime Video…);
   a theme only picks colors, marks and a few variants, so a new platform of an existing family
   needs a config here (and its CSS colors in index.css), not new page components.
   Design rules for a new theme: see CONTRIBUTING.md ("Designing a platform"). */
import { ReactNode } from "react";
import { PlatformInfo } from "./platform";
import { WrappedMark } from "./components/NetflixShell";
import { YtMark } from "./wrapped/cards";

export type Family = "videos" | "shows";

export interface WrappedLook {
  mark: (size: number) => ReactNode;  // small logo on the year picker and story cards
  pickerBg: string;                     // year picker background
  tiles: string[];                      // year tile gradients, in order
  backdrop: string;                     // glow behind the story player
  tileFont?: string;
}

export interface PlatformTheme {
  family: Family;
  /** creators pictured as round avatars (channels) or 2:3 posters (shows) */
  creatorShape: "circle" | "poster";
  /** hub and Data sources tile */
  tile: { bg: string; fg?: string };
  wrapped: WrappedLook;
  /** shows family: use the anime layouts (home rows, show page, poster cards) instead of the default ones */
  anime?: boolean;
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
  },
  crunchyroll: {
    family: "shows", creatorShape: "poster", anime: true,
    tile: { bg: "linear-gradient(140deg,#ff640a,#7a2a05)" },
    wrapped: showsWrapped("#f47521", "#c85a12", "#8a3d0c", "#5a2a0b", "#000"),
  },
  // planned platforms: hub tiles for now; their family config comes with their connector
  spotify: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#1ed760,#0b5c2a)", fg: "#0b0b0b" }, wrapped: YOUTUBE_WRAPPED },
  prime_video: { family: "shows", creatorShape: "poster", tile: { bg: "linear-gradient(140deg,#00a8e1,#0b2a4a)" }, wrapped: showsWrapped("#00a8e1", "#0a7fb0", "#0b4f75", "#0b2a4a", "#05080d") },
  tiktok: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#25f4ee 0%,#111 45%,#fe2c55 100%)" }, wrapped: YOUTUBE_WRAPPED },
  instagram: { family: "videos", creatorShape: "circle", tile: { bg: "linear-gradient(140deg,#f58529,#dd2a7b 50%,#8134af)" }, wrapped: YOUTUBE_WRAPPED },
};

const DEFAULT_VIDEOS = THEMES.youtube;
const DEFAULT_SHOWS: PlatformTheme = {
  family: "shows", creatorShape: "poster",
  tile: { bg: "linear-gradient(140deg,rgb(var(--c-accent)),#111)" },
  wrapped: showsWrapped("#e50914", "#b20710", "#831010", "#5c0a0f", "#0b0b0b"),
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
