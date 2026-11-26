/* Social apps on the shelf: magazines lying flat in a stack at the end, not books. Books are where your hours went;
   social apps have no hours (they don't export time spent), so a magazine carries its own real count instead
   ("3,759 likes"). Each one opens that app's pages. */
import { ReactNode } from "react";
import { PlatformSummary } from "../../api";
import { compact, num } from "../../format";
import { HubLink } from "../../platform";

export const MAGAZINE_W = 196;
const MAG_H = 56;

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
                   className="shelf-lift shelf-focus flex items-center justify-between gap-3 px-4 no-underline"
                   style={{ width: flat ? "100%" : MAGAZINE_W - (i % 2 ? 10 : 0), height: MAG_H, background: c.bg, color: c.fg,
                            marginLeft: flat ? 0 : (i % 2 ? 6 : 0) }}>
            <span aria-hidden className="font-shelf-display text-[28px] uppercase leading-none">{p.name}</span>
            <span aria-hidden className="whitespace-nowrap text-right font-shelf-display text-[17px] uppercase leading-none">{label(p)}</span>
          </HubLink>
        );
      })}
      {top && <div className="w-full">{top}</div>}
    </div>
  );
}
