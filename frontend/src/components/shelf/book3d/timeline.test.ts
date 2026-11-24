import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { tiltFromHeight, Axis, HOVER_TILT_DEG, T_END, T_NAVIGATE, T_OPEN, T_TURNED, cameraDistance, frustum, plan, tiltPivot, track } from "./timeline";

/** Where a point of the book lands on screen (CSS px) at time t, using three's own math, posed exactly
 *  as scene.ts poses it. */
function screenPoint(spine: { left: number; top: number; width: number; height: number }, view: { w: number; h: number },
                     axis: Axis, t: number, local: [number, number, number], tilt0 = 0): [number, number] {
  const P = plan(spine, view, axis, tilt0);
  const s = P.pose(t);
  const book = new THREE.Group();
  book.rotation.order = "ZXY";
  book.rotation.set(s.tilt, s.yaw, s.roll);
  const [ox, oy, oz] = tiltPivot(P.dims.H, s.tilt);
  const c = Math.cos(s.roll), sn = Math.sin(s.roll);
  book.position.set(s.pos[0] + ox * c - oy * sn, s.pos[1] + ox * sn + oy * c, s.pos[2] + oz);
  book.updateMatrixWorld();
  const cam = new THREE.PerspectiveCamera(P.fov, view.w / view.h, 10, P.d * 4);
  cam.position.set(s.eye[0], s.eye[1], P.d);
  cam.updateMatrixWorld();
  const f = frustum(view, s.eye, P.d, 10);
  cam.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, 10, P.d * 4);
  const v = new THREE.Vector3(...local).applyMatrix4(book.matrixWorld).project(cam);
  return [((v.x + 1) / 2) * view.w, ((1 - v.y) / 2) * view.h];
}

const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 0);
  expect(a[1]).toBeCloseTo(b[1], 0);
};

describe("the book starts exactly on the spine you clicked", () => {
  it("laptop: the spine face covers the spine's rectangle", () => {
    const spine = { left: 96, top: 264, width: 220, height: 460 }, view = { w: 1440, h: 800 };
    const { T, H } = plan(spine, view, "y").dims;
    // spine face: local x = 0, z from -T/2 (left on screen) to +T/2, y from -H/2 (bottom) to +H/2
    near(screenPoint(spine, view, "y", 0, [0, H / 2, -T / 2]), [96, 264]);
    near(screenPoint(spine, view, "y", 0, [0, H / 2, T / 2]), [316, 264]);
    near(screenPoint(spine, view, "y", 0, [0, -H / 2, T / 2]), [316, 724]);
  });
  it("phone: the spine lies sideways in the stack", () => {
    const spine = { left: 16, top: 330, width: 358, height: 120 }, view = { w: 390, h: 844 };
    const { T, H } = plan(spine, view, "x").dims;
    // rolled a quarter clockwise: the book's top is at the right
    near(screenPoint(spine, view, "x", 0, [0, H / 2, -T / 2]), [374, 330]);
    near(screenPoint(spine, view, "x", 0, [0, -H / 2, T / 2]), [16, 450]);
  });
});

describe("it ends inside the title page", () => {
  for (const [axis, view] of [["y", { w: 1440, h: 800 }], ["x", { w: 390, h: 844 }]] as const) {
    it(`${axis === "y" ? "laptop" : "phone"}: the right-hand page covers the whole window`, () => {
      const spine = axis === "y" ? { left: 96, top: 264, width: 140, height: 430 } : { left: 16, top: 330, width: 358, height: 90 };
      const P = plan(spine, view, axis);
      const { pageW, pageH, T, board } = P.dims;
      const zTop = T / 2 - board;
      const end = T_END;
      const tl = screenPoint(spine, view, axis, end, [1, pageH / 2, zTop]);
      const br = screenPoint(spine, view, axis, end, [1 + pageW, -pageH / 2, zTop]);
      expect(tl[0]).toBeLessThanOrEqual(0);
      expect(tl[1]).toBeLessThanOrEqual(0);
      expect(br[0]).toBeGreaterThanOrEqual(view.w);
      expect(br[1]).toBeGreaterThanOrEqual(view.h);
    });
  }
});

describe("the hover tilt carries straight into the book", () => {
  it("a spine tipped by CSS (perspective at its foot) projects where the 3D book starts", () => {
    const spine = { left: 96, top: 264, width: 220, height: 460 }, view = { w: 1440, h: 800 };
    const a = (HOVER_TILT_DEG * Math.PI) / 180, d = cameraDistance(view);
    const { T, H } = plan(spine, view, "y", a).dims;
    // CSS: rotateX about the bottom edge, then perspective(d) from the bottom-center of the spine
    const css = (dx: number, up: number): [number, number] => {
      const y = up * Math.cos(a), z = up * Math.sin(a), k = d / (d - z);
      return [96 + 110 + dx * k, 724 - y * k];
    };
    near(screenPoint(spine, view, "y", 0, [0, H / 2, -T / 2], a), css(-110, 460));
    near(screenPoint(spine, view, "y", 0, [0, H / 2, T / 2], a), css(110, 460));
    near(screenPoint(spine, view, "y", 0, [0, 0, T / 2], a), css(110, 230));
  });
});

describe("reading the hover's tilt back", () => {
  it("finds the angle from the spine's height on screen, untipped or partway", () => {
    const d = 1500, h = 460;
    const look = (a: number) => (h * Math.cos(a) * d) / (d - h * Math.sin(a));
    expect(tiltFromHeight(h, h, d)).toBe(0);
    for (const deg of [2, 5, HOVER_TILT_DEG]) {
      expect(tiltFromHeight(look((deg * Math.PI) / 180), h, d)).toBeCloseTo((deg * Math.PI) / 180, 4);
    }
  });
});

describe("timing", () => {
  it("swaps the page only once the backdrop hides it, before the cover opens", () => {
    const P = plan({ left: 0, top: 0, width: 100, height: 400 }, { w: 1200, h: 800 }, "y");
    expect(P.pose(T_NAVIGATE).backdrop).toBe(1);
    expect(P.pose(T_NAVIGATE).cover).toBe(0);
    expect(P.pose(T_TURNED - 140).cover).toBe(0);
    expect(P.pose(T_OPEN).cover).toBeCloseTo(-Math.PI);
    expect(P.pose(0).backdrop).toBe(0);
    expect(T_END).toBeLessThanOrEqual(1500);
  });
  it("track eases between keys and holds outside them", () => {
    const k: [number, number][] = [[0, 10], [100, 20]];
    expect(track(k, -5)).toBe(10);
    expect(track(k, 50)).toBeCloseTo(15);
    expect(track(k, 500)).toBe(20);
  });
});
