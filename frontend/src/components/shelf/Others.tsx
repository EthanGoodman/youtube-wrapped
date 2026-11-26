/* The smallest apps folded into one spine when the shelf is full: "+N" and their hours, opening a short list. */
import { useEffect, useRef, useState } from "react";
import { PlatformSummary } from "../../api";
import { num } from "../../format";
import { HubLink } from "../../platform";
import { hoursOf } from "./Spine";
import { OTHERS_W } from "./scale";

export function OthersSpine({ items, colors, h }: { items: PlatformSummary[]; colors: Record<string, { bg: string; fg: string }>; h: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hours = items.reduce((s, p) => s + hoursOf(p), 0);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              aria-label={`${items.length} more apps: ${items.map((p) => p.name).join(", ")}. ${num(hours)} hours`}
              className="shelf-tip shelf-focus flex flex-col items-center justify-between bg-[#2A2622] py-[14px] text-[#EDE7DC]"
              style={{ width: OTHERS_W, height: h }}>
        <span aria-hidden className="font-shelf-display text-[16px] leading-none">{num(hours)} Hrs</span>
        <span aria-hidden className="shelf-vertical font-shelf-display text-[40px] uppercase leading-none">+{items.length} more</span>
        <span aria-hidden />
      </button>
      {open && (
        <ul className="absolute bottom-full right-0 z-20 mb-2 flex w-64 flex-col border-2 border-[#EDE7DC] bg-[#141312] p-1">
          {items.map((p) => (
            <li key={p.id}>
              <HubLink to={`/${p.id}`} className="shelf-focus flex items-center gap-3 px-3 py-2.5 text-[15px] text-[#EDE7DC] no-underline hover:bg-[#2A2622]">
                <span aria-hidden className="h-6 w-2 shrink-0" style={{ background: colors[p.id]?.bg }} />
                <span className="flex-1 font-bold">{p.name}</span>
                <span className="font-shelf-mono text-[12px] text-[#C9C2B5]">{num(hoursOf(p))} hrs</span>
              </HubLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
