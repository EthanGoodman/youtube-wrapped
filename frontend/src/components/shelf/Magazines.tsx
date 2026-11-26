/* Social apps on the shelf: magazines lying flat in a stack at the end, not books. Books are where your hours went;
   social apps have no hours (they don't export time spent), so a magazine carries its own real count instead
   ("3,759 likes"). Each one opens that app's pages. */
import { ReactNode } from "react";
import { PlatformSummary } from "../../api";
import { compact, num } from "../../format";
import { HubLink } from "../../platform";

export const MAGAZINE_W = 196;
const MAG_H = 56;

/** The biggest font (up to `max`) at which `text` fits in `width` px; never below `min` (then it truncates). */
export function fitFont(text: string, width: number, max: number, min: number): number {
  return Math.max(min, Math.min(max, Math.floor(width / (Math.max(1, text.length) * 0.42))));
}

const label = (p: PlatformSummary) =>
  p.headline ? `${compact(p.headline.value)} ${p.headline.unit}` : `${compact(p.items ?? 0)} ${p.vocab.items}`;

/** `top`: something lying on top of the stack (the "+ N more" slot), so the end of the shelf is one pile. */
export function MagazineStack({ items, colors, flat = false, top }: {
  items: PlatformSummary[]; colors: Record<string, { bg: string; fg: string }>; flat?: boolean; top?: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div className={flat ? "flex w-full flex-col gap-2" : "flex shrink-0 flex-col-reverse items-start gap-[3px]"} style={flat ? undefined : { width: MAGAZINE_W }}>
      {items.map((p, i) => {
        const c = colors[p.id] ?? { bg: "#2A2622", fg: "#EDE7DC" };
        return (
          <HubLink key={p.id} to={`/${p.id}`}
                   aria-label={`${p.name} stats: ${p.headline ? `${num(p.headline.value)} ${p.headline.unit}` : `${num(p.items ?? 0)} ${p.vocab.items}`}`}
                   className={`shelf-lift shelf-focus flex min-w-0 overflow-hidden px-4 no-underline ${flat ? "items-center justify-between gap-3" : "flex-col justify-center gap-1"}`}
                   style={{ width: flat ? "100%" : MAGAZINE_W - (i % 2 ? 10 : 0), height: MAG_H, background: c.bg, color: c.fg,
                            marginLeft: flat ? 0 : (i % 2 ? 6 : 0) }}>
            {/* the name above, the count under it: both fit the magazine (Bebas glyphs average ~0.42em), never past its edge */}
            <span aria-hidden className="truncate font-shelf-display uppercase leading-none"
                  style={{ fontSize: flat ? 28 : fitFont(p.name, MAGAZINE_W - 42, 24, 14) }}>{p.name}</span>
            <span aria-hidden className={`truncate font-shelf-display uppercase leading-none ${flat ? "shrink-0 text-right" : ""}`}
                  style={{ fontSize: flat ? 17 : fitFont(label(p), MAGAZINE_W - 42, 15, 10), opacity: flat ? 1 : 0.85 }}>{label(p)}</span>
          </HubLink>
        );
      })}
      {top && <div className="w-full">{top}</div>}
    </div>
  );
}
