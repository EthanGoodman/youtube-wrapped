/* An app not added yet: an empty dashed slot that says how long its data takes to arrive. */
import { PlatformSummary } from "../../api";
import { HubLink } from "../../platform";
import { shortWait } from "./scale";

export function waitLabel(p: PlatformSummary): string {
  return p.implemented ? shortWait(p.export_wait) : "Coming soon";
}

function slotLabel(p: PlatformSummary): string {
  const wait = shortWait(p.export_wait);
  const arrives = wait ? ` Your data takes ${wait} to arrive.` : "";
  return p.implemented ? `Add ${p.name}.${arrives}` : `${p.name} is coming soon.${arrives}`;
}

interface Props { p?: PlatformSummary; more?: number; w: number; h: number; flat?: boolean }

/** A slot for one app (`p`), or the "+ N more" slot (`more`). */
export function EmptySlot({ p, more, w, h, flat = false }: Props) {
  const to = p ? `/sources?add=${p.id}` : "/sources";
  const title = p ? `+ ${p.name}` : `+ ${more} more`;
  const wait = p ? waitLabel(p) : "";
  const label = p ? slotLabel(p) : `${more} more apps you can add`;
  if (flat) {
    return (
      <HubLink to={to} aria-label={label}
               className="shelf-slot shelf-focus flex h-14 w-full items-center justify-between border-2 border-dashed border-[#5C554B] px-4 text-[#A39B8D]">
        <span aria-hidden className="font-shelf-display text-[26px] uppercase leading-none">{title}</span>
        {wait && <span aria-hidden className="font-shelf-mono text-[12px] uppercase">{wait}</span>}
      </HubLink>
    );
  }
  return (
    <HubLink to={to} aria-label={label}
             className="shelf-lift shelf-slot shelf-focus flex shrink-0 items-center justify-center border-2 border-dashed border-[#5C554B] text-[#A39B8D]"
             style={{ width: w, height: h }}>
      <span aria-hidden className="shelf-vertical flex items-center gap-3">
        <span className="font-shelf-display text-[34px] uppercase leading-none">{title}</span>
        {wait && <span className="font-shelf-mono text-[12px] uppercase">{wait}</span>}
      </span>
    </HubLink>
  );
}
