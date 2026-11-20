/* Building blocks for the Crunchyroll-styled stats pages: info tags, square posters with Crunchyroll's
   hover panel (stats, not a play button), the 4px progress bar. */
import { ReactNode } from "react";
import { Television } from "@phosphor-icons/react";
import { Link } from "../platform";
import { useLinkQuery } from "../filters";
import { num } from "../format";
import type { ShowStatus } from "./shows";

export const ORANGE = "#ff640a";
export const TEAL = "#2abdbb";
export const GREEN = "#2abdbb";  // Crunchyroll has no green: "finished" uses its teal
export const STATUS: Record<ShowStatus, { label: string; color: string }> = {
  finished: { label: "Finished", color: TEAL },
  watching: { label: "Watching", color: ORANGE },
  dropped: { label: "Dropped", color: "#8c8c8c" },
};

type TagTone = "orange" | "teal" | "dark" | "gold" | "light";
const TONES: Record<TagTone, string> = {
  orange: "bg-[#ff7b2e] text-black",
  teal: "bg-[#213944] text-white",
  dark: "bg-[#151515] text-[#bbb]",
  gold: "bg-[#151515] text-[#fab818]",
  light: "bg-[#ece1c2] text-black",
};

/** Crunchyroll's little uppercase info tag (SUB, DUB, SIMULCAST, FALL 2023…). */
export function Tag({ children, tone = "dark" }: { children: ReactNode; tone?: TagTone }) {
  return (
    <span className={`inline-flex h-4 shrink-0 items-center px-1 text-[10px] font-bold uppercase leading-[11px] tracking-[0.03em] shadow-[0_0_4px_rgba(0,0,0,.5)] ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** "Sub | Dub" the way Crunchyroll writes it under a card, from how much you watched dubbed. */
export function subDub(dubShare: number | null | undefined): string | null {
  if (dubShare == null) return null;
  if (dubShare >= 0.9) return "Dub";
  if (dubShare <= 0.1) return "Sub";
  return "Sub | Dub";
}

/** Gray metadata line with Crunchyroll's 4px dot separators. */
export function Meta({ items, className = "" }: { items: (ReactNode | null | undefined | false)[]; className?: string }) {
  const shown = items.filter(Boolean);
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-[#8c8c8c] ${className}`}>
      {shown.map((it, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="h-1 w-1 shrink-0 rounded-full bg-[#8c8c8c]" aria-hidden />}
          <span className="truncate">{it}</span>
        </span>
      ))}
    </div>
  );
}

/** 4px progress bar (black track, orange fill unless a status color is given). */
export function Bar({ pct, status, className = "" }: { pct: number | null | undefined; status?: ShowStatus | null; className?: string }) {
  return (
    <div className={`h-1 bg-[#ffffff26] ${className}`}>
      <div className="h-full" style={{ width: `${(pct ?? 0) * 100}%`, background: status ? STATUS[status].color : ORANGE }} />
    </div>
  );
}

export function PosterImg({ src, className = "" }: { src?: string | null; className?: string }) {
  return src
    ? <img src={src} alt="" loading="lazy" className={`aspect-[2/3] w-full bg-[#151515] object-cover ${className}`} />
    : <div className={`flex aspect-[2/3] w-full items-center justify-center bg-[#151515] text-[#8c8c8c] ${className}`}><Television size={28} weight="fill" /></div>;
}

export interface CRShow {
  key: string;
  title: string;
  poster: string | null;
  count: number;
  time_s: number;
  watched?: number | null;
  total?: number | null;
  pct?: number | null;
  status?: ShowStatus | null;
  studios?: string[];
  anime_season?: string | null;
  score?: number | null;
  format?: string | null;
  genres: string[];
  dub_share?: number | null;
  rank?: number;
  overview?: string | null;
}

/** Square poster card. Hover opens Crunchyroll's dark panel (8px past the card) with your stats for
 *  that show over a ghosted poster: no description-and-play-button, this is a stats page. */
export function PosterCard({ s, line, className = "" }: { s: CRShow; line?: ReactNode; className?: string }) {
  const q = useLinkQuery();
  const hours = s.time_s >= 3600 ? `${num(Math.round(s.time_s / 3600))}h` : `${Math.round(s.time_s / 60)}m`;
  return (
    <Link to={`/channel/${s.key}${q}`} className={`group relative block ${className}`}>
      <div className="relative">
        <PosterImg src={s.poster} />
        {s.rank != null && <span className="absolute left-0 top-0"><Tag tone="orange">#{s.rank}</Tag></span>}
        {s.pct != null && <Bar pct={s.pct} status={s.status} className="absolute inset-x-0 bottom-0" />}
      </div>
      <div className="pt-3">
        <div className="truncate text-[14px] font-medium text-white">{s.title}</div>
        {line ?? <Meta items={[`${num(s.count)} eps`, hours, subDub(s.dub_share)]} />}
      </div>
      {/* hover panel */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#151515] p-3 opacity-0 shadow-[0_0_0_8px_#151515] transition-opacity duration-150 ease-in-out group-hover:opacity-100">
        {s.poster && <img src={s.poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-[0.05]" />}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="line-clamp-2 text-[14px] font-bold leading-tight text-white">{s.title}</div>
          <Meta className="mt-1" items={[s.anime_season, s.studios?.[0]]} />
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="text-[#8c8c8c]">Episodes</dt>
            <dd className="text-right font-bold text-white">{s.total ? `${num(s.watched ?? s.count)} / ${num(s.total)}` : num(s.count)}</dd>
            <dt className="text-[#8c8c8c]">Watched</dt><dd className="text-right font-bold text-white">{hours}</dd>
            {s.pct != null && <><dt className="text-[#8c8c8c]">Done</dt><dd className="text-right font-bold" style={{ color: s.status ? STATUS[s.status].color : ORANGE }}>{Math.round(s.pct * 100)}%</dd></>}
            {s.score != null && <><dt className="text-[#8c8c8c]">AniList</dt><dd className="text-right font-bold text-[#fab818]">★ {s.score}</dd></>}
          </dl>
          <div className="mt-auto flex flex-wrap gap-1 pt-3">
            {s.status && <Tag tone={s.status === "finished" ? "teal" : s.status === "watching" ? "orange" : "dark"}>{STATUS[s.status].label}</Tag>}
            {subDub(s.dub_share) && <Tag>{subDub(s.dub_share)}</Tag>}
            {s.format && s.format !== "TV" && <Tag>{s.format.replace("_", " ")}</Tag>}
          </div>
        </div>
      </div>
    </Link>
  );
}
