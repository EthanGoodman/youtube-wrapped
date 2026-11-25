/* Shared chart pieces for the new pages, so every chart behaves the same: hover a bar or square to read it in a line
   above the chart (the rest fades back), hover a legend shade to light only that level. Plain HTML, so they match
   the cream pages exactly and work with the keyboard (bars that link are focusable). */
import { ReactNode, useState } from "react";
import { Link } from "../platform";
import { useLinkQuery } from "../filters";
import { OV } from "./kit";
import { HEAT } from "./takeaways";

/** The line above a chart: what you're pointing at, or a hint. */
export function Readout({ text, active, dark = false }: { text: string; active: boolean; dark?: boolean }) {
  const color = active ? (dark ? OV.paper : OV.ink) : dark ? OV.mute : OV.soft;
  return <p aria-live="polite" className="min-h-[22px] text-[15px] font-bold" style={{ color }}>{text}</p>;
}

export interface Bar { key: string; label: string; value: number; display: string; color: string; to?: string; above?: string }

/** Vertical bars with a hover readout. `ticks` is the label row under the bars (each chart words its own axis). */
export function HoverBars({ bars, height, hint, dark = false, gap = 3, ticks, ariaLabel, radius = 3 }: {
  bars: Bar[]; height: number; hint: string; dark?: boolean; gap?: number; ticks?: ReactNode; ariaLabel: string; radius?: number;
}) {
  const [on, setOn] = useState<string | null>(null);
  const q = useLinkQuery();
  const max = Math.max(1e-9, ...bars.map((b) => b.value));
  const hovered = bars.find((b) => b.key === on);
  return (
    <div className="flex flex-col gap-2">
      <Readout text={hovered ? `${hovered.label} · ${hovered.display}` : hint} active={!!hovered} dark={dark} />
      <div className="grid items-end" role="img" aria-label={ariaLabel} onMouseLeave={() => setOn(null)}
           style={{ height, gap, gridTemplateColumns: `repeat(${bars.length},minmax(0,1fr))` }}>
        {bars.map((b) => {
          const style = { height: "100%", opacity: on && on !== b.key ? 0.3 : 1 };
          const inner = (
            <>
              {b.above && <span className="text-center font-shelf-mono text-[11px]">{b.above}</span>}
              <span className="block w-full" style={{ height: `${Math.max(1.5, (b.value / max) * (b.above ? 88 : 100))}%`, background: b.color, borderRadius: `${radius}px ${radius}px 0 0` }} />
            </>
          );
          const cls = "flex flex-col justify-end transition-opacity duration-150";
          return b.to
            ? <Link key={b.key} to={b.to + q} className={cls} style={style} aria-label={`${b.label}: ${b.display}`}
                    onMouseEnter={() => setOn(b.key)} onFocus={() => setOn(b.key)} onBlur={() => setOn(null)}>{inner}</Link>
            : <span key={b.key} className={cls} style={style} onMouseEnter={() => setOn(b.key)}>{inner}</span>;
        })}
      </div>
      {ticks}
    </div>
  );
}

/** Evenly spaced axis labels under a chart. */
export function Ticks({ labels, dark = false }: { labels: string[]; dark?: boolean }) {
  return (
    <div aria-hidden className="grid font-shelf-mono text-[11px]" style={{ gridTemplateColumns: `repeat(${labels.length},minmax(0,1fr))`, color: dark ? OV.mute : OV.soft }}>
      {labels.map((l, i) => <span key={i} className="overflow-visible whitespace-nowrap">{l}</span>)}
    </div>
  );
}

/** The heat legend; its shades are buttons: hovering (or focusing) one lights only the cells at that level. */
export function HeatLegend({ level, setLevel }: { level: number | null; setLevel: (l: number | null) => void }) {
  return (
    <span className="flex items-center gap-1 font-shelf-mono text-[11px]" style={{ color: OV.soft }} onMouseLeave={() => setLevel(null)}>
      Less
      {HEAT.map((c, i) => (
        <button key={c} type="button" aria-label={i === 0 ? "Show the empty cells" : `Show level ${i} of ${HEAT.length - 1}`}
                onMouseEnter={() => setLevel(i)} onFocus={() => setLevel(i)} onBlur={() => setLevel(null)}
                className="flex h-7 w-7 items-center justify-center rounded">
          <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: c, boxShadow: level === i ? `0 0 0 2px ${OV.ink}` : undefined }} />
        </button>
      ))}
      More
    </span>
  );
}
