/* The Overview's plain-language takeaways: pure functions, so they're easy to test. */
import type { HourPoint, MonthPoint } from "../api";
import type { Filters } from "../filters";

/** Filters for rankings: long videos and music only, unless Shorts are all you asked for (Wrapped does the same). */
export function rankingFilters(f: Filters): Filters {
  const sat = f.buckets.filter((b) => b === "long" || b === "music");
  return sat.length ? { ...f, buckets: sat } : f;
}

/** What this period is compared with. "This year" compares with the same dates last year, so "less than this time
 *  last year" is literally true; other periods use the API's previous period of the same length. */
export interface Comparison { label: string; start?: string; end?: string }

export function comparison(f: { range: string }, today: string | undefined): Comparison | null {
  if (f.range === "all") return null;
  if (f.range === "this_year") {
    if (!today) return null;
    const y = Number(today.slice(0, 4)) - 1;
    const md = today.slice(4) === "-02-29" ? "-02-28" : today.slice(4);
    return { label: "this time last year", start: `${y}-01-01`, end: `${y}${md}` };
  }
  if (/^\d{4}$/.test(f.range)) return { label: String(Number(f.range) - 1) };
  if (f.range === "4w") return { label: "the 4 weeks before" };
  if (f.range === "6m") return { label: "the 6 months before" };
  return { label: "the period before" };
}

/** "56% less than this time last year." (null when there's nothing to compare with). */
export function changeLine(current: number, previous: number | null | undefined, label: string): string | null {
  if (previous == null || previous <= 0) return null;
  const change = current / previous - 1;
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return `About the same as ${label}.`;
  return `${pct}% ${change < 0 ? "less" : "more"} than ${label}.`;
}

/** Hours for a list: one decimal under 10 ("9.8 h"), whole hours above. */
export function hoursShort(seconds: number): string {
  const h = seconds / 3600;
  return h < 10 ? `${(Math.round(h * 10) / 10).toString()} h` : `${Math.round(h)} h`;
}

/** Hour 0-23 as "12 AM" / "3 PM". */
export function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
}

/** The busiest hour, and the share of videos started between midnight and 5 am. */
export function clockFacts(clock: HourPoint[]): { peak: number; night: number } | null {
  const total = clock.reduce((s, h) => s + h.count, 0);
  if (!total) return null;
  const peak = clock.reduce((best, h) => (h.count > best.count ? h : best)).hour;
  const night = clock.filter((h) => h.hour < 5).reduce((s, h) => s + h.count, 0) / total;
  return { peak, night };
}

/** A short line about the busiest hour. */
export function clockLine(f: { peak: number; night: number }): string {
  if (f.night >= 0.2) return `is your busiest hour. About ${oneIn(f.night)} videos started after midnight.`;
  if (f.peak >= 5 && f.peak < 12) return "is your busiest hour. An early start.";
  return "is your busiest hour.";
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Totals per weekday from a weekday x hour grid (Monday first), and the busiest day's name. */
export function weekdayFacts(grid: number[][]): { totals: number[]; busiest: string } | null {
  const totals = grid.map((row) => row.reduce((s, n) => s + n, 0));
  if (!totals.some(Boolean)) return null;
  const i = totals.indexOf(Math.max(...totals));
  return { totals, busiest: DAY_NAMES[i] };
}

/** 0.24 -> "1 in 4". */
export function oneIn(share: number): string {
  return `1 in ${Math.max(1, Math.round(1 / share))}`;
}

/** How a channel moved since the comparison period: one kind of fact, colored by direction.
 *  `prevRank` undefined = nothing to compare with (no badge); null = it wasn't ranked then. */
export type Move = { text: string; tone: "up" | "down" | "new" | "same" };

export function rankMove(rank: number, prevRank: number | null | undefined): Move | null {
  if (prevRank === undefined) return null;
  if (prevRank === null) return { text: "new", tone: "new" };
  const d = prevRank - rank;
  if (d > 0) return { text: `↑ ${d}`, tone: "up" };
  if (d < 0) return { text: `↓ ${-d}`, tone: "down" };
  return { text: "same spot", tone: "same" };
}

/** Headline for the top channels card: "JomezPro, again" when it was #1 then too. */
export function topHeadline(title: string | null | undefined, prevRank: number | null | undefined): string {
  const name = title ?? "Your #1";
  return prevRank === 1 ? `${name}, again` : `${name}, your #1`;
}

/** Time per calendar year from monthly totals, oldest first: in hours, or in another unit (`per` = seconds per
 *  unit, 60 for minutes). The field is called `hours` either way. */
export function yearlyHours(months: MonthPoint[], per = 3600): { year: number; hours: number }[] {
  const by = new Map<number, number>();
  for (const m of months) {
    const y = Number(m.month.slice(0, 4));
    by.set(y, (by.get(y) ?? 0) + m.time_s);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, s]) => ({ year, hours: Math.round(s / per) }))
    .filter((y, i, all) => y.hours > 0 || i > all.findIndex((x) => x.hours > 0));
}

/** The calendar years a "#1 channel each year" view should show, or null when the period is too short for one
 *  (a single year already has one #1). Lifetime, or a custom range of 4+ years. */
export function yearsToShow(f: { range: string; start?: string; end?: string }, firstDate: string | null | undefined,
                            today: string | undefined): number[] | null {
  let start: string | null | undefined, end: string | null | undefined;
  if (f.range === "all") [start, end] = [firstDate, today];
  else if (f.range === "custom" && f.start && f.end) {
    const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
    if (days < 4 * 365) return null;
    [start, end] = [f.start, f.end];
  } else return null;
  if (!start || !end) return null;
  const out: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) out.push(y);
  return out;
}

/** Consecutive years with the same #1 channel, merged into one "reign". */
export interface Reign<T> { from: number; to: number; first: T; years: T[]; total_s: number }

export function groupReigns<T extends { year: number; channel_id: string; time_s: number }>(rows: T[]): Reign<T>[] {
  const out: Reign<T>[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.first.channel_id === r.channel_id && last.to === r.year - 1) {
      last.to = r.year;
      last.years.push(r);
      last.total_s += r.time_s;
    } else out.push({ from: r.year, to: r.year, first: r, years: [r], total_s: r.time_s });
  }
  return out;
}

/** The longest run of consecutive years with the same #1 channel. */
export function longestReign(tops: { year: number; title?: string | null }[]): { title: string; years: number } | null {
  let best: { title: string; years: number } | null = null;
  let run = 0;
  tops.forEach((t, i) => {
    const prev = tops[i - 1];
    run = prev && prev.title === t.title && prev.year === t.year - 1 ? run + 1 : 1;
    if (t.title && (!best || run > best.years)) best = { title: t.title, years: run };
  });
  return best;
}

/** Light sequential ramp for heat cells (0 = empty, 1 = busiest): cream, sand, mustard, then red-orange.
 *  Each step is darker than the one before, so "more" always reads darker. */
export const HEAT = ["#EDE4D3", "#E8D2A6", "#E2B262", "#D98E35", "#C2622B", "#9E3B1F"];

/** Which step of HEAT a value falls on (0 = nothing). */
export function heatLevel(value: number, max: number): number {
  if (!value || !max) return 0;
  return 1 + Math.min(HEAT.length - 2, Math.floor((value / max) * (HEAT.length - 1)));
}

export function heatColor(value: number, max: number): string {
  return HEAT[heatLevel(value, max)];
}

/** The range of values a HEAT step covers, e.g. [117, 234] for step 2 when the busiest is 585. */
export function heatRange(level: number, max: number): [number, number] {
  if (level <= 0) return [0, 0];
  const steps = HEAT.length - 1;
  return [Math.ceil(((level - 1) / steps) * max) || 1, level === steps ? max : Math.floor((level / steps) * max)];
}

/** "You watch 2.1× as much on weekend days" from per-day averages. */
export function weekendLine(weekday: number, weekend: number): string {
  if (!weekday && !weekend) return "Not enough data yet.";
  if (!weekday) return "Only on weekends.";
  const r = weekend / weekday;
  if (r >= 1.15) return `${(Math.round(r * 10) / 10).toString()}× as much on a weekend day as on a weekday.`;
  if (r <= 0.87) return `${(Math.round((1 / r) * 10) / 10).toString()}× as much on a weekday as on a weekend day.`;
  return "About the same on weekdays and weekends.";
}

/** Day cells arranged in week columns (Monday on top), padded so the first column starts on Monday. */
export function calendarWeeks<T extends { date: string }>(days: T[]): (T | null)[][] {
  if (!days.length) return [];
  const first = new Date(days[0].date + "T00:00:00");
  const pad = (first.getDay() + 6) % 7; // Monday = 0
  const cells: (T | null)[] = [...Array(pad).fill(null), ...days];
  const weeks: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** A color per channel for the whole bar chart race: assigned when a channel first shows up, picking a color no
 *  channel on screen in that frame already has (colors only repeat once the earlier channel has left). */
export function raceColors(frames: { top: { channel_id: string }[] }[], palette: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let next = 0;
  for (const f of frames) {
    const onScreen = new Set(f.top.map((t) => out[t.channel_id]).filter(Boolean));
    for (const t of f.top) {
      if (out[t.channel_id]) continue;
      let pick = palette[next % palette.length];
      for (let k = 0; k < palette.length && onScreen.has(pick); k++) pick = palette[(next + k + 1) % palette.length];
      out[t.channel_id] = pick;
      onScreen.add(pick);
      next++;
    }
  }
  return out;
}

/** The bar race at any moment between two monthly frames (t = 2.5 is halfway through the month after frame 2), so
 *  playback can glide instead of jumping. Values are cumulative, so a channel missing from a frame is just below that
 *  frame's last bar: it slides in from the bottom rather than popping in. */
export function raceAt(frames: { top: { channel_id: string; value: number }[] }[], t: number, n: number): { channel_id: string; value: number }[] {
  if (!frames.length) return [];
  const last = frames.length - 1;
  const ti = Math.max(0, Math.min(t, last));
  const a = frames[Math.floor(ti)];
  const b = frames[Math.min(last, Math.floor(ti) + 1)];
  const p = ti - Math.floor(ti);
  if (p === 0) return a.top.slice(0, n);
  const A = new Map(a.top.map((x) => [x.channel_id, x.value]));
  const B = new Map(b.top.map((x) => [x.channel_id, x.value]));
  const floorA = a.top.length ? a.top[a.top.length - 1].value : 0;
  const floorB = b.top.length ? b.top[b.top.length - 1].value : 0;
  const ids = new Set([...A.keys(), ...B.keys()]);
  return [...ids]
    .map((id) => {
      const va = A.get(id) ?? Math.min(floorA, B.get(id) ?? floorA);
      const vb = B.get(id) ?? Math.max(va, floorB);
      return { channel_id: id, value: va + (vb - va) * p };
    })
    .sort((x, y) => y.value - x.value)
    .slice(0, n);
}

/** "Nov 30" from an ISO date. */
export function monthDay(d: string | null | undefined): string {
  return d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

/** "Sep 24 to Oct 15" from two ISO dates. */
export function spanLabel(start: string, end: string): string {
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return start === end ? fmt(start) : `${fmt(start)} to ${fmt(end)}`;
}

/** The hours card's label: "2026 so far", "2025", "Past 4 weeks", "Lifetime". */
export function periodTitle(f: { range: string; start?: string; end?: string }, today: string | undefined): string {
  if (f.range === "this_year") return today ? `${today.slice(0, 4)} so far` : "This year";
  if (/^\d{4}$/.test(f.range)) return f.range;
  if (f.range === "4w") return "Past 4 weeks";
  if (f.range === "6m") return "Past 6 months";
  if (f.range === "12m") return "Past year";
  if (f.range === "all") return "Lifetime";
  return f.start && f.end ? `${f.start} to ${f.end}` : "Custom range";
}

/** The year a range is about: "2025" -> 2025, "this_year" -> the current year, else null. */
export function periodYear(range: string, today: string | undefined): number | null {
  if (/^\d{4}$/.test(range)) return Number(range);
  if (range === "this_year" && today) return Number(today.slice(0, 4));
  return null;
}
