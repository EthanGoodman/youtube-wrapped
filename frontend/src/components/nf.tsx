/* Small building blocks for the Netflix-styled stats pages. */
import { ReactNode } from "react";
import { Film } from "lucide-react";
import { duration, num } from "../format";
import type { ShowStatus } from "./shows";

export const RED = "rgb(var(--c-accent))";  // the platform accent (Netflix red, Crunchyroll orange)
export const GREEN = "#46d369";
export const STATUS: Record<ShowStatus, { label: string; color: string }> = {
  finished: { label: "Finished", color: GREEN },
  watching: { label: "Watching", color: RED },
  dropped: { label: "Dropped", color: "#b3b3b3" },
};

export const hours = (s: number) => (s >= 3600 ? `${num(Math.round(s / 3600))}h` : duration(s));
export const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
/** TMDB images come in sizes; ask for a sharper one when shown bigger. */
export const sharper = (url: string | null | undefined, size = "w342") => (url ? url.replace(/\/w\d+\//, `/${size}/`) : null);

/** Netflix's Top 10 numeral: dark fill with a gray outline. */
export function OutlinedRank({ n, className = "" }: { n: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 150" className={className} aria-hidden>
      <text x={n >= 10 ? 52 : 60} y="140" textAnchor="middle" fontSize="150" fontWeight="900" letterSpacing="-14"
            fontFamily="Inter, sans-serif" fill="#141414" stroke="#595959" strokeWidth="4" paintOrder="stroke fill">
        {n}
      </text>
    </svg>
  );
}

/** 2:3 poster, with a film icon when there's no art. */
export function Poster({ src, size = "w342", className = "", alt = "" }: { src?: string | null; size?: string; className?: string; alt?: string }) {
  const url = sharper(src, size);
  return url
    ? <img src={url} alt={alt} loading="lazy" className={`aspect-[2/3] w-full rounded-[4px] bg-[#2f2f2f] object-cover ${className}`} />
    : <div className={`flex aspect-[2/3] w-full items-center justify-center rounded-[4px] bg-[#2f2f2f] text-[#808080] ${className}`}><Film size={20} /></div>;
}

/** Thin progress bar in the show's status color. */
export function Progress({ pct, status, className = "" }: { pct: number | null | undefined; status?: ShowStatus | null; className?: string }) {
  return (
    <div className={`h-[3px] bg-[#404040] ${className}`}>
      <div className="h-full" style={{ width: `${(pct ?? 0) * 100}%`, background: status ? STATUS[status].color : RED }} />
    </div>
  );
}

export function StatusLabel({ status }: { status: ShowStatus }) {
  return <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: STATUS[status].color }}>{STATUS[status].label}</span>;
}

/** Big page title in the Netflix style, with a quiet subtitle. */
export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(32px,3.6vw,52px)] font-black leading-none tracking-[-0.03em]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-[#b3b3b3]">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Two-way toggle with Netflix-style labels. */
export function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/** Row of big numbers on dark tiles (Shows: 130 · Finished 21 · …). */
export function FigureStrip({ items }: { items: { label: string; value: string; color?: string; sub?: string }[] }) {
  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[4px] bg-white/[0.06] ${items.length >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"}`}>
      {items.map((it) => (
        <div key={it.label} className="bg-[#181818] px-5 py-4">
          <div className="text-[clamp(30px,3vw,46px)] font-black leading-none tracking-tight" style={{ color: it.color }}>{it.value}</div>
          <div className="mt-1.5 text-[13px] text-[#b3b3b3]">{it.label}</div>
          {it.sub && <div className="text-[12px] text-[#808080]">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
