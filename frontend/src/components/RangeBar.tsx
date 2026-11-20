import { useEffect, useRef, useState } from "react";
import { CalendarRange, Check, ChevronDown, Settings2 } from "lucide-react";
import { useMeta } from "../api";
import { ALL_BUCKETS, Bucket, useFilters } from "../filters";
import { useCapability } from "../platform";

const PRESETS: [string, string][] = [
  ["4w", "4 weeks"],
  ["6m", "6 months"],
  ["12m", "12 months"],
  ["this_year", "This year"],
  ["all", "Lifetime"],
];

/** stats.fm-style time-range chips + year picker + custom range + filter settings. One row, above content. */
export function RangeBar() {
  const { filters, update } = useFilters();
  const hasShorts = useCapability("shorts");
  const meta = useMeta().data;
  const years = [...(meta?.years ?? [])].reverse();
  const isYear = /^\d{4}$/.test(filters.range);

  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0">
      {PRESETS.map(([key, label]) => (
        <button key={key} className={`chip ${filters.range === key ? "chip-active" : ""}`}
                aria-pressed={filters.range === key} onClick={() => update({ range: key })}>
          {label}
        </button>
      ))}
      <Popover
        label={
          <span className={`chip ${isYear ? "chip-active" : ""}`}>
            {isYear ? filters.range : "Year"} <ChevronDown size={14} />
          </span>
        }
      >
        {(close) => (
          <div className="grid grid-cols-3 gap-1 p-1">
            {years.map((y) => (
              <button key={y} onClick={() => { update({ range: String(y) }); close(); }}
                      className={`rounded-md px-3 py-2 text-sm hover:bg-raised ${filters.range === String(y) ? "bg-ink text-bg hover:bg-ink" : ""}`}>
                {y}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover
        label={
          <span className={`chip ${filters.range === "custom" ? "chip-active" : ""}`}>
            <CalendarRange size={14} /> {filters.range === "custom" ? `${filters.start} – ${filters.end}` : "Custom"}
          </span>
        }
      >
        {(close) => <CustomRange onDone={close} min={meta?.first_date} max={meta?.today} />}
      </Popover>
      <div className="ml-auto flex items-center gap-2 pl-2">
        {hasShorts && <ContentSwitch />}
        <Popover align="right" label={<span className="chip" aria-label="Filters"><Settings2 size={16} /></span>}>
          {() => <SettingsPanel />}
        </Popover>
      </div>
    </div>
  );
}

/** One-tap content switch. "Videos" = long-form + music; removed/private videos only count under "All"
 *  (we can't tell what they were). Finer control lives in the settings panel. */
const CONTENT: [string, string, Bucket[]][] = [
  ["all", "All", ALL_BUCKETS],
  ["videos", "Videos", ["long", "music"]],
  ["shorts", "Shorts", ["short"]],
];

function ContentSwitch() {
  const { filters, update } = useFilters();
  const same = (a: Bucket[], b: Bucket[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="seg shrink-0 !text-sm" role="group" aria-label="Show">
      {CONTENT.map(([key, label, buckets]) => (
        <button key={key} aria-pressed={same(filters.buckets, buckets)} onClick={() => update({ buckets })}
                className="!px-3.5 !py-1.5">
          {label}
        </button>
      ))}
    </div>
  );
}

export function CustomRange({ onDone, min, max }: { onDone: () => void; min?: string | null; max?: string }) {
  const { filters, update } = useFilters();
  const [start, setStart] = useState(filters.start ?? min ?? "");
  const [end, setEnd] = useState(filters.end ?? max ?? "");
  return (
    <form className="flex w-64 flex-col gap-2 p-2"
          onSubmit={(e) => { e.preventDefault(); if (start && end) { update({ range: "custom", start, end }); onDone(); } }}>
      <label className="text-xs text-sub">From
        <input type="date" value={start} min={min ?? undefined} max={max} onChange={(e) => setStart(e.target.value)}
               className="mt-1 w-full rounded-md bg-raised px-2 py-1.5 text-sm text-ink [color-scheme:dark]" />
      </label>
      <label className="text-xs text-sub">To
        <input type="date" value={end} min={min ?? undefined} max={max} onChange={(e) => setEnd(e.target.value)}
               className="mt-1 w-full rounded-md bg-raised px-2 py-1.5 text-sm text-ink [color-scheme:dark]" />
      </label>
      <button type="submit" className="mt-1 rounded-full bg-ink py-1.5 text-sm font-medium text-bg hover:bg-white">Apply</button>
    </form>
  );
}

function SettingsPanel() {
  const { filters, update } = useFilters();
  const meta = useMeta().data;
  const toggle = (b: Bucket) => {
    const has = filters.buckets.includes(b);
    const next = has ? filters.buckets.filter((x) => x !== b) : [...filters.buckets, b];
    if (next.length) update({ buckets: next });
  };
  const hasShorts = useCapability("shorts");
  const hasBackground = useCapability("background");
  const rows: [Bucket, string, string][] = [
    ["long", "Long-form videos", "Regular videos"],
    ["short", "Shorts", "Detected from vertical video ≤ 3 min (approximate)"],
    ["music", "YouTube Music", meta?.has_music ? "Songs from YouTube Music" : "None in your history"],
    ["unknown", "Removed & private videos", "Deleted since you watched them: no length or type is known"],
  ];
  return (
    <div className="w-72 p-1">
      <div className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-muted">Include</div>
      {rows.filter(([b]) => b === "long" || hasShorts).map(([b, label, hint]) => (
        <CheckRow key={b} checked={filters.buckets.includes(b)} onClick={() => toggle(b)} label={label} hint={hint} />
      ))}
      <div className="my-1 border-t border-line" />
      {hasBackground && <>
      <div className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-muted">Watch time</div>
      <CheckRow checked={filters.bg} onClick={() => update({ bg: !filters.bg })}
                label="Leave out sleep / background audio"
                hint="Long rain, sleep and ambient videos still count as watches, but add no time" />
      </>}
    </div>
  );
}

function CheckRow({ checked, onClick, label, hint }: { checked: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button onClick={onClick} role="menuitemcheckbox" aria-checked={checked}
            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-raised">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {checked && <Check size={16} strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

export function Popover({ label, children, align = "left" }: {
  label: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(align === "right" ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 300) });
    setOpen((o) => !o);
  };
  return (
    <div ref={ref} className="shrink-0">
      <button type="button" onClick={toggle} aria-expanded={open}>{label}</button>
      {open && (
        <div className="fixed z-50 rounded-xl border border-line bg-[#282828] shadow-2xl" style={pos}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
