/* Sizes on the hub shelf: pure functions, so they can be tested and reasoned about.
   Bebas Neue's average glyph is about 0.42em wide; the formulas keep every label inside its spine. */

export interface Size { w: number; h: number }

const share = (hours: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, hours / max)) : 1);

export const SHELF_MAX_H = 460;
export const SHELF_MIN_H = 240;

/** The tallest spine that lets the whole shelf fit in the window: `room` is the height left between
 *  the shelf's top and the bottom of the window (minus the plank and caption). */
export function shelfHeight(room: number): number {
  return Math.round(Math.max(SHELF_MIN_H, Math.min(SHELF_MAX_H, room)));
}

/** A tape spine: as thick as its hours (the biggest app is 220 wide, the smallest about 56).
 *  `maxH` is the tallest spine (460 on a tall window, less on a short one); heights keep their ratios. */
export function spineSize(hours: number, max: number, maxW = 220, maxH = SHELF_MAX_H): Size {
  const r = share(hours, max);
  return { w: Math.min(maxW, Math.round(56 + 164 * r)), h: Math.round((maxH * (400 + 60 * r)) / SHELF_MAX_H) };
}

export const SPINE_MIN_W = 56;
export const OTHERS_W = 84;

/** Fit a row of spines (natural widths, biggest first) into `room` px with `gap` between them, never wrapping:
 *  - they fit: unchanged;
 *  - too wide: every spine gives up the same share of its width above the minimum, so the biggest stay biggest;
 *  - still too wide at the minimum: the smallest fold into one "Others" spine (`OTHERS_W` wide) at the end.
 *  Returns the widths of the spines kept (in order) and how many were folded. */
export function fitShelf(widths: number[], room: number, gap: number): { widths: number[]; folded: number } {
  const n = widths.length;
  const total = (ws: number[], extra = 0) => ws.reduce((a, b) => a + b, 0) + gap * Math.max(0, ws.length - 1 + extra);
  if (!n || total(widths) <= room) return { widths, folded: 0 };
  const shrink = (ws: number[], space: number) => {
    const above = ws.reduce((a, w) => a + (w - SPINE_MIN_W), 0);
    const k = above ? Math.max(0, Math.min(1, (space - ws.length * SPINE_MIN_W) / above)) : 0;
    return ws.map((w) => Math.floor(SPINE_MIN_W + (w - SPINE_MIN_W) * k));
  };
  if (n * SPINE_MIN_W + gap * (n - 1) <= room) return { widths: shrink(widths, room - gap * (n - 1)), folded: 0 };
  // keep as many as fit at the minimum width next to the Others spine
  const keep = Math.max(0, Math.floor((room - OTHERS_W) / (SPINE_MIN_W + gap)));
  const kept = widths.slice(0, keep);
  return { widths: shrink(kept, room - OTHERS_W - gap * keep), folded: n - keep };
}

/** An empty slot's height on a shelf whose tallest spine is `maxH` (380 of 460). */
export function slotHeight(maxH: number, full = false): number {
  return full ? maxH : Math.round((maxH * 380) / SHELF_MAX_H);
}

/** Hours label across the top of a spine ("4,135 Hrs"): a fifth of the spine's thickness, smaller if the
 *  label would otherwise run past its edges. */
export function hoursFontSize(w: number, label = ""): number {
  const fits = Math.floor((w - 8) / (Math.max(1, label.length) * 0.42));
  return Math.max(10, Math.min(Math.max(16, Math.round(w * 0.2)), fits));
}

/** "4,135 Hrs" */
export const hoursLabel = (hours: string) => `${hours} Hrs`;

/** App name running up the spine: fits its thickness and its length (top and bottom labels reserved). */
export function nameFontSize(w: number, h: number, name: string): number {
  const chars = Math.max(1, name.length);
  return Math.max(12, Math.min(120, Math.round(w * 0.55), Math.floor((h - 130) / (chars * 0.42))));
}

/** A year box: as tall as that year's hours. */
export function yearBoxHeight(hours: number, max: number): number {
  return Math.round(120 + 130 * share(hours, max));
}

/** Phone: a spine lying flat, as tall as its hours. */
export function flatSpineHeight(hours: number, max: number): number {
  return Math.round(56 + 64 * share(hours, max));
}

/** How fast an app's data arrives, from its export_wait text ("instant", "up to 30 days"…): lower is faster. */
export function waitRank(text: string | null | undefined): number {
  const t = (text ?? "").toLowerCase();
  if (!t) return 9;
  if (t.startsWith("instant")) return 0;
  if (/minute/.test(t) && !/hour|day/.test(t)) return 1;
  if (/minute|hour/.test(t)) return 2;
  if (/day/.test(t) && !/30|month/.test(t)) return 3;
  return 4;
}

/** The short form of export_wait for a slot: "instant (quick) or a few days (full)" -> "instant". */
export function shortWait(text: string | null | undefined): string {
  return (text ?? "").split(/ \(| or |;/)[0].trim();
}
