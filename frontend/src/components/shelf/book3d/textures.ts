/* Everything printed on the book, drawn on canvases: the spine (a pixel match for the one on the shelf),
   the cover, the title page, ordinary printed pages, and the paper edges. */
import { hoursFontSize, nameFontSize } from "../scale";

export interface BookText {
  name: string;
  hours: string;          // "4,135 hours"
  line: string;           // "71K videos · since Nov 2018"
  spineHours: string;     // "4,135 Hrs"
  spineMeta: string[];    // ["71K videos", "since Nov 2018"] (shown when the spine is wide enough)
}
export interface Colors { bg: string; fg: string }

const DISPLAY = '"Bebas Neue", Impact, sans-serif';
const MONO = '"DM Mono", ui-monospace, monospace';
export const PAPER = "#F3EEE4";

export async function loadFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`40px ${DISPLAY}`), document.fonts.load(`12px ${MONO}`)]);
  } catch { /* draw with fallbacks */ }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")!];
}

/** The spine as the shelf shows it, in the spine face's own frame (width = thickness, height = length).
 *  Phone: the shelf shows it lying down (name left, hours right); it is drawn turned a quarter so the
 *  book, rolled onto its side, shows it the same way. */
export function spineCanvas(t: BookText, c: Colors, thick: number, length: number, lying: boolean, scale = 2) {
  const [cv, g] = canvas(thick * scale, length * scale);
  g.scale(scale, scale);
  g.fillStyle = c.bg;
  g.fillRect(0, 0, thick, length);
  g.fillStyle = c.fg;
  if (lying) {
    // DOM (dx right, dy down) -> face (x = dy, y = length - dx)
    g.transform(0, -1, 1, 0, 0, length);
    const w = length, h = thick;
    g.textBaseline = "middle";
    g.font = `36px ${DISPLAY}`;
    g.textAlign = "left";
    g.fillText(t.name.toUpperCase(), 16, h / 2 + 2);
    g.font = `28px ${DISPLAY}`;
    g.textAlign = "right";
    g.fillText(t.spineHours, w - 16, h / 2 + 2);
    return cv;
  }
  const w = thick, h = length;
  const hs = hoursFontSize(w, t.spineHours);
  const ns = nameFontSize(w, h, t.name);
  const meta = w >= 120 && h >= 300 ? t.spineMeta : [];
  const metaH = meta.length ? meta.length * 11 * 1.375 : 0;
  g.textAlign = "center";
  g.textBaseline = "top";
  g.font = `${hs}px ${DISPLAY}`;
  g.fillText(t.spineHours, w / 2, 14 + hs * 0.08);
  // name: vertical, reading bottom to top, centered in the space between the labels
  g.font = `${ns}px ${DISPLAY}`;
  const nameLen = g.measureText(t.name.toUpperCase()).width;
  const gap = (h - 28 - hs - nameLen - metaH) / 2;
  const cy = 14 + hs + gap + nameLen / 2;
  g.save();
  g.translate(w / 2, cy);
  g.rotate(-Math.PI / 2);
  g.textBaseline = "middle";
  g.fillText(t.name.toUpperCase(), 0, ns * 0.04);
  g.restore();
  if (meta.length) {
    g.font = `11px ${MONO}`;
    g.textBaseline = "top";
    meta.forEach((m, i) => g.fillText(m.toUpperCase(), w / 2, h - 14 - metaH + i * 11 * 1.375 + 2));
  }
  return cv;
}

/** Fits text to a width: the largest size (<= max) at which it is no wider than `width`. */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, width: number, max: number) {
  g.font = font(100);
  const w100 = g.measureText(text).width || 1;
  return Math.min(max, Math.floor((width / w100) * 100));
}

/** The front cover: the app's color, name up top, hours at the foot. */
export function coverCanvas(t: BookText, c: Colors, W: number, H: number, scale = 3) {
  const [cv, g] = canvas(W * scale, H * scale);
  g.scale(scale, scale);
  g.fillStyle = c.bg;
  g.fillRect(0, 0, W, H);
  const pad = Math.round(W * 0.09);
  g.fillStyle = c.fg;
  g.textBaseline = "top";
  const ns = fit(g, t.name.toUpperCase(), (px) => `${px}px ${DISPLAY}`, W - pad * 2, H * 0.24);
  g.font = `${ns}px ${DISPLAY}`;
  g.fillText(t.name.toUpperCase(), pad, pad);
  g.textBaseline = "alphabetic";
  const hs = Math.round(Math.max(18, ns * 0.42));
  g.font = `${hs}px ${DISPLAY}`;
  g.fillText(t.hours.toUpperCase(), pad, H - pad - 18);
  g.font = `${Math.max(7, Math.round(W * 0.03))}px ${MONO}`;
  g.globalAlpha = 0.8;
  g.fillText(t.line.toUpperCase(), pad, H - pad);
  // a thin rule framing the cover, like a stamped board
  g.globalAlpha = 0.25;
  g.strokeStyle = c.fg;
  g.lineWidth = 1;
  g.strokeRect(pad * 0.45, pad * 0.45, W - pad * 0.9, H - pad * 0.9);
  return cv;
}

/** Page edges: hundreds of fine lines. `across` = lines run across the canvas's width. */
export function edgeCanvas(lines: number, across: boolean) {
  const n = Math.max(8, Math.min(400, Math.round(lines)));
  const [cv, g] = canvas(across ? 16 : n * 3, across ? n * 3 : 16);
  g.fillStyle = "#EFE8DB";
  g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 5 === 0 ? "rgba(90,75,55,0.30)" : "rgba(90,75,55,0.16)";
    if (across) g.fillRect(0, i * 3 + 1, cv.width, 1);
    else g.fillRect(i * 3 + 1, 0, 1, cv.height);
  }
  return cv;
}
