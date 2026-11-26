/* The "+ N more" slot at the end of the shelf: a short menu with the combined views (All games) and the apps not
   added yet. Not a book itself: combined views are built from the books on the shelf. */
import { useEffect, useRef, useState } from "react";
import { PlatformSummary } from "../../api";
import { num } from "../../format";
import { HubLink } from "../../platform";
import { waitLabel } from "./EmptySlot";

/** flat: the phone's lying-flat list; slab: a dashed magazine on top of the magazine stack (opens upward) */
interface Props { views: PlatformSummary[]; toAdd: PlatformSummary[]; w: number; h: number; flat?: boolean; slab?: boolean }

export function MoreSlot({ views, toAdd, w, h, flat = false, slab = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const title = toAdd.length ? `+ ${toAdd.length} more` : "+ More";
  const label = [views.map((v) => v.name).join(", "), toAdd.length ? `${toAdd.length} apps you can add` : ""].filter(Boolean).join("; ");
  return (
    <div ref={ref} className={`relative ${flat || slab ? "w-full" : "shrink-0"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`More: ${label}`}
              className={flat || slab
                ? "shelf-slot shelf-focus flex h-14 w-full items-center justify-between border-2 border-dashed border-[#5C554B] px-4 text-[#A39B8D]"
                : "shelf-lift shelf-slot shelf-focus flex items-center justify-center border-2 border-dashed border-[#5C554B] text-[#A39B8D]"}
              style={flat || slab ? undefined : { width: w, height: h }}>
        <span aria-hidden className={`${flat || slab ? "" : "shelf-vertical"} font-shelf-display ${slab ? "text-[26px]" : "text-[30px]"} uppercase leading-none`}>{title}</span>
      </button>
      {open && (
        <div className={`absolute z-20 w-72 border-2 border-[#EDE7DC] bg-[#141312] p-1 ${flat ? "left-0 top-full mt-2" : "bottom-full right-0 mb-2"}`}>
          {views.length > 0 && (
            <ul className="flex flex-col border-b border-[#3A3530] pb-1">
              {views.map((v) => (
                <li key={v.id}>
                  <HubLink to={`/${v.id}`} className="shelf-focus flex items-center justify-between gap-3 px-3 py-2.5 text-[#EDE7DC] no-underline hover:bg-[#2A2622]">
                    <span className="flex flex-col">
                      <span className="text-[16px] font-bold">{v.name}</span>
                      <span className="text-[12px] text-[#C9C2B5]">Every game platform together</span>
                    </span>
                    <span className="font-shelf-mono text-[12px] text-[#C9C2B5]">{num(Math.round((v.est_s ?? 0) / 3600))} hrs</span>
                  </HubLink>
                </li>
              ))}
            </ul>
          )}
          {toAdd.length > 0 && (
            <ul className="flex flex-col pt-1">
              {toAdd.map((p) => (
                <li key={p.id}>
                  <HubLink to={`/sources?add=${p.id}`} className="shelf-focus flex items-center justify-between gap-3 px-3 py-2 text-[15px] text-[#EDE7DC] no-underline hover:bg-[#2A2622]">
                    <span>+ {p.name}</span>
                    <span className="font-shelf-mono text-[11px] uppercase text-[#A39B8D]">{waitLabel(p)}</span>
                  </HubLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
