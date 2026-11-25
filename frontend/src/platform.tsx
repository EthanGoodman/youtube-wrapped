/* The current platform (from the URL: /youtube/..., /netflix/...) and helpers built on it. */
import { forwardRef } from "react";
import {
  Link as RouterLink, LinkProps, NavLink as RouterNavLink, NavLinkProps, To, useParams,
} from "react-router-dom";
import { useMeta } from "./api";
import { themeOf } from "./themes";

/** Known platform ids: the built-in ones, plus every id /api/platforms reports (registerPlatforms). */
export const PLATFORM_IDS = ["youtube", "netflix", "spotify", "prime_video", "tiktok", "instagram", "crunchyroll", "steam"];

export function registerPlatforms(ids: string[]) {
  ids.forEach((id) => { if (!PLATFORM_IDS.includes(id)) PLATFORM_IDS.push(id); });
}
export const DEFAULT_PLATFORM = "youtube";

export interface PlatformInfo {
  id: string;
  name: string;
  implemented: boolean;
  theme: string;
  vocab: { creator: string; creators: string; item: string; items: string; verb: string; verbed: string; time: string };
  capabilities: string[];
  export_steps: string[];
  export_wait: string;
  issue: number | null;
  family?: "video" | "music" | "games" | "social" | "reading" | "fitness";
}

/** Platform id from the URL, or null outside a platform (the hub). */
export function usePlatformId(): string | null {
  const { platform } = useParams();
  return platform && PLATFORM_IDS.includes(platform) ? platform : null;
}

/** Full platform info (wording, capabilities) for the current page. */
export function usePlatform(): PlatformInfo | undefined {
  return useMeta().data?.platform;
}

/** How creators are pictured: round avatars (YouTube channels) or 2:3 posters (shows). */
export function useCreatorShape(): "circle" | "poster" {
  return themeOf(usePlatform()).creatorShape;
}

/** The current platform's theme (family, look, variants). */
export function useTheme() {
  return themeOf(usePlatform());
}

export function useCapability(capability: string): boolean {
  // until meta loads, assume yes so YouTube's layout doesn't jump
  const p = usePlatform();
  return p ? p.capabilities.includes(capability) : true;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Wording for the current platform: v.creators -> "channels", V.creators -> "Channels". */
export function useVocab() {
  const v = usePlatform()?.vocab ?? {
    creator: "channel", creators: "channels", item: "video", items: "videos",
    verb: "watch", verbed: "watched", time: "watch time",
  };
  const V = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, cap(s)])) as typeof v;
  return { v, V };
}

/** "/top/channels?x" -> "/youtube/top/channels?x" inside a platform; untouched elsewhere. */
export function withPlatform(to: To, platform: string | null): To {
  if (!platform || typeof to !== "string" || !to.startsWith("/")) return to;
  const first = to.split(/[/?#]/)[1];
  if (PLATFORM_IDS.includes(first)) return to;  // already has a platform
  return `/${platform}${to === "/" ? "" : to}`;
}

/** Drop-in for react-router's Link: internal paths stay inside the current platform. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
  return <RouterLink ref={ref} to={withPlatform(to, usePlatformId())} {...rest} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink({ to, ...rest }, ref) {
  return <RouterNavLink ref={ref} to={withPlatform(to, usePlatformId())} {...rest} />;
});

/** Link that always leaves the platform (e.g. back to the hub). */
export { RouterLink as HubLink };

// ------------------------------------------------------------------ wording

/** Current platform wording, set when entering a platform (YouTube's words map to themselves). */
let currentVocab: PlatformInfo["vocab"] | null = null;
let currentName = "Netflix";

export function setVocab(v: PlatformInfo["vocab"] | null, name?: string) {
  currentVocab = v;
  if (name) currentName = name;
}

/** The current platform's verb ("watch", "listen"), outside React (Wrapped cards). */
export function platformVerb(): string {
  return currentVocab?.verb ?? "watch";
}

/** The current platform's name, outside React (Wrapped cards). */
export function platformName(): string {
  return currentName;
}

/** Translate YouTube wording in a UI string to the current platform's:
 *  tr("Top channels") -> "Top shows" on Netflix; unchanged on YouTube. Keeps capitalization. */
export function tr(text: string): string {
  const v = currentVocab;
  if (!v) return text;
  const words: Record<string, string> = { videos: v.items, video: v.item, channels: v.creators, channel: v.creator };
  return text.replace(/\b(videos?|channels?)\b/gi, (m) => {
    const out = words[m.toLowerCase()] ?? m;
    return m[0] === m[0].toUpperCase() ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  });
}

/** True only once the platform is known to have episodic shows (no optimistic default:
 *  these sections call Netflix-only endpoints). */
export function useHasSeries(): boolean {
  const p = usePlatform();
  return !!p && p.capabilities.includes("series");
}
