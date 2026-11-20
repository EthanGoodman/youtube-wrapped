const nf = new Intl.NumberFormat("en-US");
const compactNf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => (n == null ? "–" : nf.format(Math.round(n)));
export const compact = (n: number | null | undefined) =>
  n == null ? "–" : n < 10_000 ? nf.format(Math.round(n)) : compactNf.format(n);

/** Seconds -> "12h 30m", "45m", "30s". */
export function duration(s: number | null | undefined): string {
  if (s == null) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 100) return `${nf.format(h)}h`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Seconds -> big-number pieces for tiles: value + unit. */
export function bigDuration(s: number): { value: string; unit: string } {
  const h = s / 3600;
  if (h >= 48) return { value: nf.format(Math.round(h)), unit: "hours" };
  if (h >= 1) return { value: h.toFixed(1), unit: "hours" };
  return { value: nf.format(Math.round(s / 60)), unit: "minutes" };
}

export const hours = (s: number) => `${nf.format(Math.round(s / 3600))}h`;
export const minutes = (s: number) => `${nf.format(Math.round(s / 60))} min`;

export const pct = (x: number | null | undefined, digits = 0) =>
  x == null ? "–" : `${(x * 100).toFixed(digits)}%`;

export function signedPct(x: number | null | undefined): string {
  if (x == null) return "";
  const v = Math.round(x * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

/** "2024-03-08" or an ISO timestamp with offset -> "Mar 8, 2024" (local wall-clock date). */
export function date(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return shortDateFmt.format(new Date(y, m - 1, d));
}
export function month(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
}
/** Wall-clock time from a local ISO string: "4:59 AM". */
export function clockTime(iso: string): string {
  const [hh, mm] = iso.slice(11, 16).split(":").map(Number);
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}
export const hourLabel = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Larger YouTube thumbnail from the stored medium one. */
export const ytThumb = (videoId: string, size: "mq" | "hq" | "maxres" = "mq") =>
  `https://i.ytimg.com/vi/${videoId}/${size}default.jpg`;
