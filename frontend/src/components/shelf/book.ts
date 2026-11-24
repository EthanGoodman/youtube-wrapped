/* Opening a book: the clicked spine slides off the shelf, turns to show its cover, grows to fill the
   window, then the cover swings open on its spine and the stats page is underneath.

   Real 3D (CSS transforms, run by the GPU). The book is built at full-window size: its cover is the
   window, its spine runs back from the cover's hinge edge. It starts shrunk and turned so that only the
   spine faces you, exactly where the spine sits on the shelf, and animates to "cover = window".
   The overlay lives on <body>, so it survives the route change underneath it. */

export type Axis = "y" | "x"; // "y": standing spine, hinge on the left; "x": lying flat (phone), hinge on top

export interface Rect { left: number; top: number; width: number; height: number }
export interface View { w: number; h: number }

export interface BookGeometry {
  /** the book's scale at the start (spine on the shelf) */
  s: number;
  /** the book's depth at full size: the spine face's thickness */
  depth: number;
  /** transforms of the whole book, start to end (same function list, so they interpolate cleanly) */
  frames: { offset: number; transform: string }[];
}

const rot = (axis: Axis, deg: number) => (axis === "y" ? `rotateY(${deg}deg)` : `rotateX(${deg}deg)`);
const tf = (axis: Axis, x: number, y: number, z: number, k: number, deg: number) =>
  `translate3d(${r2(x)}px, ${r2(y)}px, ${r2(z)}px) scale3d(${r4(k)}, ${r4(k)}, ${r4(k)}) ${rot(axis, deg)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Where the book starts (on the shelf), where it passes, and where it ends (cover = window). */
export function bookGeometry(spine: Rect, view: View, axis: Axis): BookGeometry {
  // standing: the spine's height is the book's height; lying: the spine's width is the book's width
  const s = axis === "y" ? spine.height / view.h : spine.width / view.w;
  const depth = (axis === "y" ? spine.width : spine.height) / s;
  // turned 90deg so only the spine faces you; the book's origin (top-left of the cover) sits at the
  // spine's hinge edge: right edge (standing) or bottom edge (lying)
  const a0 = axis === "y" ? 90 : -90;
  const x0 = axis === "y" ? spine.left + spine.width : spine.left;
  const y0 = axis === "y" ? spine.top : spine.top + spine.height;
  const lift = Math.min(48, view.h * 0.06);
  const mid = 0.6;
  return {
    s,
    depth,
    frames: [
      { offset: 0, transform: tf(axis, x0, y0, 0, s, a0) },
      // pulled out: up off the shelf (standing) or out of the stack (lying), toward you
      { offset: 0.2, transform: tf(axis, x0, y0 - (axis === "y" ? lift : 0), 90, s * 1.04, a0) },
      // turning in the middle of the window
      { offset: 0.62, transform: tf(axis, (view.w * (1 - mid)) / 2, (view.h * (1 - mid)) / 2, 60, mid, a0 * 0.22) },
      { offset: 1, transform: tf(axis, 0, 0, 0, 1, 0) },
    ],
  };
}

export interface CoverText { name: string; hours: string; line: string }

export interface OpenOptions {
  spine: HTMLElement;
  axis: Axis;
  color: { bg: string; fg: string };
  cover: CoverText;
  /** called once the cover fills the window: change the page underneath here */
  onCovered: () => void;
  /** resolves when the page underneath is ready to be seen */
  ready: () => Promise<void>;
}

let busy = false;

const el = (tag: string, cls: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const e = document.createElement(tag);
  e.className = cls;
  Object.assign(e.style, style);
  return e;
};

/** Plays the whole thing; resolves when the overlay is gone. */
export async function openBook({ spine, axis, color, cover, onCovered, ready }: OpenOptions): Promise<void> {
  if (busy) return;
  busy = true;
  const view = { w: window.innerWidth, h: window.innerHeight };
  const r = spine.getBoundingClientRect();
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const g = bookGeometry(rect, view, axis);

  const stage = el("div", "book-stage", { perspective: `${Math.round(Math.max(view.w, view.h) * 1.2)}px` });
  stage.setAttribute("aria-hidden", "true");
  const shade = el("div", "book-backdrop");
  const book = el("div", "book", { width: `${view.w}px`, height: `${view.h}px`, transform: g.frames[0].transform });

  // the cover: the window-sized face, hinged on the spine's edge
  const front = el("div", "book-cover", {
    background: color.bg, color: color.fg, transformOrigin: axis === "y" ? "left center" : "center top",
  });
  const pad = Math.round(Math.min(72, Math.max(24, view.w * 0.05)));
  const nameSize = Math.floor(Math.min(view.h * 0.3, (view.w - pad * 2) / (Math.max(4, cover.name.length) * 0.42)));
  front.style.padding = `${pad}px`;
  const title = el("div", "book-title", { fontSize: `${nameSize}px` });
  title.textContent = cover.name;
  const foot = el("div", "book-foot");
  const hours = el("div", "book-hours", { fontSize: `${Math.max(36, Math.round(nameSize * 0.34))}px` });
  hours.textContent = cover.hours;
  const line = el("div", "book-line");
  line.textContent = cover.line;
  foot.append(hours, line);
  const coverShade = el("div", "book-shade");
  front.append(title, foot, coverShade);

  // the spine: a copy of the one on the shelf, blown up by 1/s so the shrunk book matches it exactly
  const back = el("div", "book-spine", axis === "y"
    ? { width: `${g.depth}px`, height: `${view.h}px`, transform: `translateZ(${-g.depth}px) rotateY(-90deg)` }
    : { width: `${view.w}px`, height: `${g.depth}px`, transform: `translateZ(${-g.depth}px) rotateX(90deg)` });
  back.style.background = color.bg;
  const copy = spine.cloneNode(true) as HTMLElement;
  copy.removeAttribute("href");
  copy.className = copy.className.replace(/\bshelf-(lift|focus)\b/g, "");
  Object.assign(copy.style, {
    position: "absolute", left: "0", top: "0", margin: "0", width: `${rect.width}px`, height: `${rect.height}px`,
    transform: `scale(${1 / g.s})`, transformOrigin: "0 0",
  });
  const spineShade = el("div", "book-shade", { opacity: "0" });
  back.append(copy, spineShade);

  book.append(back, front);
  stage.append(shade, book);
  document.body.append(stage);
  spine.style.visibility = "hidden";

  const ease = "cubic-bezier(0.45, 0, 0.2, 1)";
  const flight = 950;
  try {
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: flight * 0.6, fill: "forwards", easing: "ease-out" });
    // the eye starts straight in front of the spine (so the cover hides behind it, as on a real shelf)
    // and moves to the middle of the window as the book turns
    const eye = `${Math.round(rect.left + rect.width / 2)}px ${Math.round(rect.top + rect.height / 2)}px`;
    stage.animate([{ perspectiveOrigin: eye }, { perspectiveOrigin: eye, offset: 0.2 }, { perspectiveOrigin: `${view.w / 2}px ${view.h / 2}px` }],
                  { duration: flight, fill: "forwards", easing: ease });
    // light: the spine darkens as it turns away, the cover brightens as it turns to you
    spineShade.animate([{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 0.55 }], { duration: flight, fill: "forwards", easing: ease });
    coverShade.animate([{ opacity: 0.6 }, { opacity: 0.6, offset: 0.2 }, { opacity: 0 }], { duration: flight, fill: "forwards", easing: ease });
    await book.animate(g.frames, { duration: flight, fill: "forwards", easing: ease }).finished;

    // the cover is the window now: swap the page underneath it
    back.remove();
    shade.remove();
    onCovered();
    await Promise.race([ready(), wait(1500)]);
    await frames(2);

    // open: the cover swings toward you on its hinge and fades as it passes your eye. A flatter view
    // (far eye) so the page shows from the first degrees instead of the cover bulging off-screen.
    stage.style.perspective = `${Math.round(Math.max(view.w, view.h) * 5)}px`;
    const swing = (deg: number) => (axis === "y" ? `rotateY(${-deg}deg)` : `rotateX(${deg}deg)`);
    coverShade.animate([{ opacity: 0 }, { opacity: 0.4 }], { duration: 700, fill: "forwards" });
    await front.animate(
      [{ transform: swing(0), opacity: 1 }, { transform: swing(50), opacity: 1, offset: 0.45 }, { transform: swing(105), opacity: 0 }],
      { duration: 700, fill: "forwards", easing: "cubic-bezier(0.3, 0, 0.3, 1)" },
    ).finished;
  } finally {
    stage.remove();
    spine.style.visibility = "";
    busy = false;
  }
}

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const frames = (n: number) =>
  new Promise<void>((res) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : res());
    step(n);
  });

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
