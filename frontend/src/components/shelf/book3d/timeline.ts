/* The book's choreography as pure functions of time, so it can be tested without WebGL.

   World units are CSS pixels: the camera is set up so the plane z = 0 maps 1:1 onto the window,
   x to the right of the window's center, y up. */

export type Axis = "y" | "x"; // "y": a standing spine (laptop), "x": a spine lying in a stack (phone)
export interface Rect { left: number; top: number; width: number; height: number }
export interface View { w: number; h: number }
export type V3 = [number, number, number];

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise-eased value: keys are [time ms, value]; before the first key the first value, after the last the last. */
export function track(keys: [number, number][], t: number, ease = easeInOut): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, ease((t - t0) / (t1 - t0 || 1)));
    }
  }
  return keys[keys.length - 1][1];
}

/** Window pixel -> world point on the z = 0 plane. */
export const toWorld = (x: number, y: number, view: View): [number, number] => [x - view.w / 2, view.h / 2 - y];

export const FOV = 30;

/** Camera distance for the field of view, so z = 0 is 1:1 with the window. The shelf's CSS hover tilt
 *  uses the same distance as its perspective, so the 3D book picks up exactly where the hover left it. */
export const cameraDistance = (view: View, fovDeg = FOV) => view.h / 2 / Math.tan((fovDeg * Math.PI) / 360);

/** The hover tilt (CSS rotateX on the spine, top toward you), in degrees. */
export const HOVER_TILT_DEG = 10;

/** How far a spine is tipped right now (radians), from its height on screen: the hover may be mid-way
 *  when you click. Tipping about its foot, seen from its foot at distance d, a spine `h` tall looks
 *  h·cos(a)·d / (d − h·sin(a)) tall; solved for a. */
export function tiltFromHeight(seen: number, h: number, d: number): number {
  const max = (HOVER_TILT_DEG * Math.PI) / 180;
  const look = (a: number) => (h * Math.cos(a) * d) / (d - h * Math.sin(a));
  if (seen <= look(0) + 0.25) return 0;
  let lo = 0, hi = max;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (look(mid) < seen) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Off-axis frustum at the near plane for an eye at (ex, ey, d): z = 0 still maps exactly onto the window. */
export function frustum(view: View, eye: [number, number], d: number, near: number) {
  const k = near / d;
  return {
    left: (-view.w / 2 - eye[0]) * k, right: (view.w / 2 - eye[0]) * k,
    top: (view.h / 2 - eye[1]) * k, bottom: (-view.h / 2 - eye[1]) * k,
  };
}

/* ------------------------------------------------------------------ the book */

export interface BookDims {
  H: number;      // cover height (the spine's length)
  T: number;      // thickness (the spine's width)
  W: number;      // cover width
  board: number;  // cover board thickness
  pageW: number;
  pageH: number;
}

export function bookDims(spine: Rect, axis: Axis): BookDims {
  const H = axis === "y" ? spine.height : spine.width;
  const T = axis === "y" ? spine.width : spine.height;
  const W = Math.round(H * 0.7);
  const board = Math.max(3, Math.round(T * 0.035));
  return { H, T, W, board, pageW: W - 7, pageH: H - 10 };
}

/** Milestones (ms). */
export const T_PULL = 200;      // tipped out of the shelf
export const T_TURNED = 650;    // cover facing you
export const T_NAVIGATE = 420;  // swap the page underneath (the backdrop is opaque by then)
export const T_OPEN = 950;      // cover open
export const T_END = 1150;      // the blank page fills the window
export const FADE_MS = 350;     // then the real page's content fades in over it

export interface Pose {
  pos: V3;
  yaw: number;    // about the vertical axis: pi/2 = spine facing you
  tilt: number;   // top toward you, pivoting on the bottom edge
  roll: number;   // in the screen plane (phone: -pi/2, the stack lies sideways)
  cover: number;  // front cover hinge: 0 closed, -pi open flat
  eye: [number, number];
  backdrop: number; // 0..1 opacity of the dark backdrop
}

export interface Plan {
  dims: BookDims;
  fov: number;
  d: number;
  pose: (t: number) => Pose;
}

/** z at which something appears `scale` times its size (camera distance d). */
const zAt = (scale: number, d: number) => d * (1 - 1 / scale);

/** `tilt0`: radians the spine is already tipped (the hover), so the book starts exactly as you see it. */
export function plan(spine: Rect, view: View, axis: Axis, tilt0 = 0): Plan {
  const dims = bookDims(spine, axis);
  const { H, W, pageW, pageH } = dims;
  const d = cameraDistance(view);
  const [sx, sy] = toWorld(spine.left + spine.width / 2, spine.top + spine.height / 2, view);
  // the eye starts in front of the spine: at its foot for a standing one (where the hover's
  // perspective sits), so the tipped spine projects exactly as the CSS drew it
  const eye0: [number, number] = axis === "y" ? [sx, sy - H / 2] : [sx, sy];
  const roll0 = axis === "y" ? 0 : -Math.PI / 2;

  const closedScale = Math.min((view.h * 0.72) / H, (view.w * 0.8) / W, 1.6);
  const fill = Math.max((view.w * 1.04) / pageW, (view.h * 1.04) / pageH);
  const pageCx = 1 + pageW / 2;

  // one continuous move: turn the cover to you, then open it while moving into the right-hand page
  const xKeys: [number, number][] = [[0, sx], [T_PULL, sx], [T_TURNED, -W / 2], [T_END, -pageCx]];
  const yKeys: [number, number][] = [[0, sy], [T_PULL, sy], [T_TURNED, 0]];
  const zKeys: [number, number][] = [[0, 0], [T_PULL, 40], [T_TURNED, zAt(closedScale, d)], [T_END, zAt(fill, d)]];
  const yawKeys: [number, number][] = [[0, Math.PI / 2], [T_PULL, Math.PI / 2], [T_TURNED, 0.16], [T_OPEN, 0]];
  const tiltKeys: [number, number][] = [[0, tilt0], [T_PULL, axis === "y" ? 0.24 : 0.08], [T_TURNED, 0.05], [T_OPEN, 0]];
  const rollKeys: [number, number][] = [[0, roll0], [T_PULL, roll0], [T_TURNED, 0]];
  const coverKeys: [number, number][] = [[0, 0], [T_TURNED - 140, 0], [T_OPEN, -Math.PI]];
  const eyeX: [number, number][] = [[0, eye0[0]], [T_PULL, eye0[0]], [T_TURNED, 0]];
  const eyeY: [number, number][] = [[0, eye0[1]], [T_PULL, eye0[1]], [T_TURNED, 0]];
  const backKeys: [number, number][] = [[0, 0], [40, 0], [380, 1]];

  return {
    dims, fov: FOV, d,
    pose: (t) => ({
      pos: [track(xKeys, t), track(yKeys, t), track(zKeys, t)],
      yaw: track(yawKeys, t), tilt: track(tiltKeys, t), roll: track(rollKeys, t),
      cover: track(coverKeys, t, easeInOutSine),
      eye: [track(eyeX, t), track(eyeY, t)],
      backdrop: track(backKeys, t, easeOut),
    }),
  };
}

/** Origin offset for tipping the book about its bottom-front edge instead of its middle. */
export function tiltPivot(H: number, tilt: number): V3 {
  return [0, (H / 2) * (Math.cos(tilt) - 1), (H / 2) * Math.sin(tilt)];
}
