/* One app on the shelf: a tape spine as thick as its hours. A button: selecting it fills the detail panel. */
import { PlatformSummary } from "../../api";
import { compact, num } from "../../format";
import { flatSpineHeight, hoursFontSize, nameFontSize, spineSize } from "./scale";

export const hoursOf = (p: PlatformSummary) => Math.round((p.est_s ?? 0) / 3600);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Nov 2018" (short) or "November 2018" (long) from "2018-11-30". */
export function monthYear(iso: string | null | undefined, long = false): string {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  const name = MONTHS[m - 1] ?? "";
  return `${long ? name : name.slice(0, 3)} ${y}`;
}

export function spineLabel(p: PlatformSummary): string {
  return `${p.name}, ${num(hoursOf(p))} hours, ${num(p.items ?? 0)} ${p.vocab.items} since ${monthYear(p.first_date, true)}`;
}

interface Props {
  p: PlatformSummary;
  max: number;
  color: { bg: string; fg: string };
  selected: boolean;
  onSelect: () => void;
  maxW?: number;
  flat?: boolean;
}

export function Spine({ p, max, color, selected, onSelect, maxW = 220, flat = false }: Props) {
  const hours = hoursOf(p);
  const common = {
    type: "button" as const,
    onClick: onSelect,
    "aria-pressed": selected,
    "aria-label": spineLabel(p),
  };
  if (flat) {
    return (
      <button {...common} className="shelf-lift shelf-focus flex w-full items-center justify-between px-4 text-left"
              style={{ height: flatSpineHeight(hours, max), background: color.bg, color: color.fg }}>
        <span aria-hidden className="font-shelf-display text-[36px] uppercase leading-none">{p.name}</span>
        <span aria-hidden className="font-shelf-display text-[28px] leading-none">{num(hours)} H</span>
      </button>
    );
  }
  const { w, h } = spineSize(hours, max, maxW);
  return (
    <button {...common} className="shelf-lift shelf-focus flex shrink-0 flex-col items-center justify-between py-[14px]"
            style={{ width: w, height: h, background: color.bg, color: color.fg }}>
      <span aria-hidden className="font-shelf-display leading-none" style={{ fontSize: hoursFontSize(w) }}>{num(hours)} H</span>
      <span aria-hidden className="shelf-vertical font-shelf-display uppercase leading-none"
            style={{ fontSize: nameFontSize(w, h, p.name) }}>{p.name}</span>
      {w >= 120 ? (
        <span aria-hidden className="text-center font-shelf-mono text-[11px] uppercase leading-snug">
          {compact(p.items ?? 0)} {p.vocab.items}<br />since {monthYear(p.first_date)}
        </span>
      ) : <span aria-hidden />}
    </button>
  );
}
