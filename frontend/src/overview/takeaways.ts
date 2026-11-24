/* The Overview's plain-language takeaways: pure functions, so they're easy to test. */
import type { HourPoint, MonthPoint, RankedItem } from "../api";
import type { Filters } from "../filters";

/** Filters for rankings: long videos and music only, unless Shorts are all you asked for (Wrapped does the same). */
export function rankingFilters(f: Filters): Filters {
  const sat = f.buckets.filter((b) => b === "long" || b === "music");
  return sat.length ? { ...f, buckets: sat } : f;
}

/** "56% less than 2025": how this period's hours compare with the one before (null when there's nothing to compare). */
export function changeLine(change: number | null, range: string, days: number): string | null {
  if (change == null || !isFinite(change) || range === "all") return null;
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return "About the same as before.";
  const dir = change < 0 ? "less" : "more";
  const before = /^\d{4}$/.test(range) ? String(Number(range) - 1)
    : range === "4w" ? "the 4 weeks before"
    : range === "6m" ? "the 6 months before"
    : `the ${days} days before`;
  return `${pct}% ${dir} than ${before}.`;
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

/** 0.24 -> "1 in 4". */
export function oneIn(share: number): string {
  return `1 in ${Math.max(1, Math.round(1 / share))}`;
}

/** A small badge for a top channel: what makes it notable this period. */
export function channelBadge(c: RankedItem, periodYear: number | null): string | null {
  if (c.rank === 1 && c.prev_rank === 1) return "#1 before too";
  if (c.is_new) return "new";
  if (c.rank_change != null && c.rank_change > 0) return `↑ ${c.rank_change} ${c.rank_change === 1 ? "place" : "places"}`;
  const since = c.first_watched ? Number(c.first_watched.slice(0, 4)) : null;
  if (since && periodYear && since === periodYear - 1) return `found in ${since}`;
  if (since) return `since ${since}`;
  return null;
}

/** Headline for the top channels card: "JomezPro, again" when it was #1 before too. */
export function topHeadline(top: RankedItem): string {
  const name = top.title ?? "Your #1";
  return top.prev_rank === 1 ? `${name}, again` : `${name}, your #1`;
}

/** Hours per calendar year from monthly totals, oldest first. */
export function yearlyHours(months: MonthPoint[]): { year: number; hours: number }[] {
  const by = new Map<number, number>();
  for (const m of months) {
    const y = Number(m.month.slice(0, 4));
    by.set(y, (by.get(y) ?? 0) + m.time_s);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, s]) => ({ year, hours: Math.round(s / 3600) }))
    .filter((y, i, all) => y.hours > 0 || i > all.findIndex((x) => x.hours > 0));
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
