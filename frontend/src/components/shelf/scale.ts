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
