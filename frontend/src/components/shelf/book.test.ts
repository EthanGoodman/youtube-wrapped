import { describe, expect, it } from "vitest";
import { bookGeometry } from "./book";

/* A tiny 3D model of the transforms book.ts uses, to check where the spine lands. */
type V = [number, number, number];
const rotY = (d: number) => (p: V): V => {
  const a = (d * Math.PI) / 180;
  return [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
};
const rotX = (d: number) => (p: V): V => {
  const a = (d * Math.PI) / 180;
  return [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
};

/** Applies "translate3d(..) scale3d(..) rotateY|X(..)" (rightmost first) to a point. */
function apply(transform: string, p: V): V {
  const args = [...transform.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].split(",").map((x) => parseFloat(x)));
  const [[tx, ty, tz], [k], [angle]] = args;
  const r = (transform.includes("rotateY") ? rotY : rotX)(angle)(p);
  return [r[0] * k + tx, r[1] * k + ty, r[2] * k + tz];
}

const view = { w: 1440, h: 800 };
const close = (a: V, b: V) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 1));

describe("the book starts exactly on the spine", () => {
  it("standing spine (laptop): the spine face covers the spine's rectangle, flat to the screen", () => {
    const spine = { left: 300, top: 260, width: 220, height: 460 };
    const g = bookGeometry(spine, view, "y");
    const start = g.frames[0].transform;
    // the spine face runs from the hinge (0, y, 0) back to (0, y, -depth)
    close(apply(start, [0, 0, 0]), [520, 260, 0]);
    close(apply(start, [0, 0, -g.depth]), [300, 260, 0]);
    close(apply(start, [0, view.h, -g.depth]), [300, 720, 0]);
  });
  it("lying spine (phone): same on the top edge", () => {
    const spine = { left: 16, top: 400, width: 358, height: 120 };
    const g = bookGeometry(spine, { w: 390, h: 844 }, "x");
    const start = g.frames[0].transform;
    close(apply(start, [0, 0, 0]), [16, 520, 0]);
    close(apply(start, [0, 0, -g.depth]), [16, 400, 0]);
    close(apply(start, [390, 0, -g.depth]), [374, 400, 0]);
  });
  it("ends with the cover filling the window", () => {
    const g = bookGeometry({ left: 0, top: 0, width: 60, height: 400 }, view, "y");
    const end = g.frames[g.frames.length - 1].transform;
    close(apply(end, [0, 0, 0]), [0, 0, 0]);
    close(apply(end, [view.w, view.h, 0]), [view.w, view.h, 0]);
  });
  it("every frame uses the same functions, so the browser interpolates them part by part", () => {
    const g = bookGeometry({ left: 10, top: 10, width: 100, height: 300 }, view, "y");
    const shape = (t: string) => t.replace(/\([^)]*\)/g, "()");
    expect(new Set(g.frames.map((f) => shape(f.transform))).size).toBe(1);
    expect(g.frames.map((f) => f.offset)).toEqual([...g.frames.map((f) => f.offset)].sort());
  });
});
