/* One app on the shelf: a book spine as thick as its hours. A link to the app's stats page; a plain click
   plays the "open the book" transition first (see book.ts). */
import { useRef } from "react";
import { PlatformSummary } from "../../api";
import { compact, num } from "../../format";
import { HubLink } from "../../platform";
import { flatSpineHeight, hoursFontSize, hoursLabel, nameFontSize, spineSize } from "./scale";

export const hoursOf = (p: PlatformSummary) => Math.round((p.est_s ?? 0) / 3600);

/** Social platforms have no hours: their book counts actions instead. */
export const isCounted = (p: PlatformSummary) => p.family === "social";

/** What a spine says across its top: "4,135 Hrs", or "8.6K Actions" for a social platform. */
export const headline = (p: PlatformSummary) => (isCounted(p) ? `${compact(p.items ?? 0)} ${p.vocab.items}` : hoursLabel(num(hoursOf(p))));

/** How thick a book is drawn, in hours: its own, or a third of the biggest book's for a social platform. */
export const sizeHours = (p: PlatformSummary, max: number) => (isCounted(p) ? Math.round(max / 3) : hoursOf(p));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Nov 2018" (short) or "November 2018" (long) from "2018-11-30". */
export function monthYear(iso: string | null | undefined, long = false): string {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  const name = MONTHS[m - 1] ?? "";
  return `${long ? name : name.slice(0, 3)} ${y}`;
}

export function spineLabel(p: PlatformSummary): string {
  return isCounted(p) ? `${p.name} stats: ${num(p.items ?? 0)} ${p.vocab.items} since ${monthYear(p.first_date, true)}`
                      : `${p.name} stats: ${num(hoursOf(p))} hours, ${num(p.items ?? 0)} ${p.vocab.items} since ${monthYear(p.first_date, true)}`;
}

interface Props {
  p: PlatformSummary;
  max: number;
  color: { bg: string; fg: string };
  /** a plain click: play the transition (the link still works for ctrl/middle click and without JS) */
  onOpen: (el: HTMLElement) => void;
  maxW?: number;
  maxH?: number;
  /** a width the shelf fitted it to (narrower than its natural one when the row is full) */
  w?: number;
  flat?: boolean;
}

export function Spine({ p, max, color, onOpen, maxW = 220, maxH, w: fitW, flat = false }: Props) {
  const hours = sizeHours(p, max);
  const top = headline(p);
  const ref = useRef<HTMLAnchorElement>(null);
  const common = {
    ref,
    to: `/${p.id}`,
    "aria-label": spineLabel(p),
    onClick: (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !ref.current) return;
      e.preventDefault();
      onOpen(ref.current);
    },
  };
  if (flat) {
    return (
      <HubLink {...common} className="shelf-lift shelf-focus flex w-full items-center justify-between px-4 text-left no-underline"
              style={{ height: flatSpineHeight(hours, max), background: color.bg, color: color.fg }}>
        <span aria-hidden className="font-shelf-display text-[36px] uppercase leading-none">{p.name}</span>
        <span aria-hidden className="font-shelf-display text-[28px] leading-none">{top}</span>
      </HubLink>
    );
  }
  const natural = spineSize(hours, max, maxW, maxH);
  const { h } = natural;
  const w = fitW ?? natural.w;
  return (
    <HubLink {...common} className="shelf-tip shelf-focus flex shrink-0 flex-col items-center justify-between py-[14px] no-underline"
            style={{ width: w, height: h, background: color.bg, color: color.fg }}>
      <span aria-hidden className="font-shelf-display leading-none" style={{ fontSize: hoursFontSize(w, top) }}>{top}</span>
      <span aria-hidden className="shelf-vertical font-shelf-display uppercase leading-none"
            style={{ fontSize: nameFontSize(w, h, p.name) }}>{p.name}</span>
      {w >= 120 && h >= 300 ? (
        <span aria-hidden className="text-center font-shelf-mono text-[11px] uppercase leading-snug">
          {compact(p.items ?? 0)} {p.vocab.items}<br />since {monthYear(p.first_date)}
        </span>
      ) : <span aria-hidden />}
    </HubLink>
  );
}
