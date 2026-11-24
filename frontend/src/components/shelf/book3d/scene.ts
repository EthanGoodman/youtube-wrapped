/* Opening a book, in WebGL (three.js). Loaded only when a spine is clicked.

   The book is built in CSS pixels at the size of the spine you clicked and starts exactly on top of it
   (tipped as far as the hover tipped it). It tips out of the shelf, turns to its cover, and the cover
   swings open while you move into the right-hand page: a blank grey-black page. Once it fills the
   window, the real page (swapped in underneath while the backdrop hid it) fades in. */
import * as THREE from "three";
import { Axis, FADE_MS, T_END, T_NAVIGATE, T_OPEN, T_TURNED, clamp, frustum, plan, tiltPivot } from "./timeline";
import { BookText, Colors, PAPER, coverCanvas, edgeCanvas, loadFonts, spineCanvas } from "./textures";

export interface OpenBook3d {
  spine: HTMLElement;
  axis: Axis;
  color: Colors;
  text: BookText;
  /** radians the spine is already tipped toward you (the hover) */
  tilt0: number;
  onCovered: () => void;
  ready: () => Promise<void>;
}

const BACKDROP = 0x141312;
const PAGE_BLACK = 0x141414; // the open pages: Netflix's grey-black, for every app
let busy = false;

/** Plays the book. Resolves false (having done nothing) when WebGL isn't available. */
export async function openBook3d(o: OpenBook3d): Promise<boolean> {
  if (busy) return true;
  busy = true;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    busy = false;
    return false;
  }
  const disposables: { dispose: () => void }[] = [];
  const cleanup = () => {
    renderer.domElement.remove();
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    o.spine.style.visibility = "";
    busy = false;
  };

  try {
    await loadFonts();
    const view = { w: window.innerWidth, h: window.innerHeight };
    const r = o.spine.getBoundingClientRect();
    // the hover tips the spine with CSS; measure it untipped (its layout box)
    const rect = { left: r.left, top: r.top, width: o.spine.offsetWidth, height: o.spine.offsetHeight };
    rect.top = r.bottom - rect.height;
    rect.left = r.left + (r.width - rect.width) / 2;
    const P = plan(rect, view, o.axis, o.tilt0);
    const { H, T, W, board, pageW, pageH } = P.dims;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    renderer.setPixelRatio(dpr);
    renderer.setSize(view.w, view.h);
    renderer.setClearColor(BACKDROP, 0);
    const cv = renderer.domElement;
    Object.assign(cv.style, { position: "fixed", inset: "0", zIndex: "100", width: "100vw", height: "100vh", cursor: "pointer" });
    cv.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const near = 10, far = P.d * 4;
    const camera = new THREE.PerspectiveCamera(P.fov, view.w / view.h, near, far);
    const setEye = (eye: [number, number]) => {
      camera.position.set(eye[0], eye[1], P.d);
      camera.updateMatrixWorld();
      const f = frustum(view, eye, P.d, near);
      camera.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, near, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    };

    // light: a face turned straight at you shows its exact color (ambient + key = pi for Lambert),
    // faces turning away darken; the key comes from the top left
    const key = new THREE.Vector3(-0.4, 0.5, 1).normalize();
    scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, (Math.PI * 0.4) / key.z);
    sun.position.copy(key);
    scene.add(sun);

    const texture = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      disposables.push(t);
      return t;
    };
    const mat = (p: THREE.MeshLambertMaterialParameters) => {
      const m = new THREE.MeshLambertMaterial(p);
      disposables.push(m);
      return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G) => (disposables.push(g), g);

    const boardMat = mat({ color: new THREE.Color(o.color.bg) });
    const endMat = mat({ color: new THREE.Color(PAGE_BLACK) }); // inside of the cover: the same grey-black as the page
    const paperMat = mat({ color: new THREE.Color(PAPER) });

    // the book: hinge (spine) along x = 0, cover facing +z, centered on y and z
    const book = new THREE.Group();
    book.rotation.order = "ZXY"; // yaw first, then tip, then roll in the screen plane
    scene.add(book);

    const spine = new THREE.Mesh(geo(new THREE.PlaneGeometry(T, H)),
      mat({ map: texture(spineCanvas(o.text, o.color, T, H, o.axis === "x", dpr * 1.5)) }));
    spine.rotation.y = -Math.PI / 2;
    spine.position.x = -0.5; // just outside the boards' edges, so they never fight over the same pixels
    book.add(spine);

    const back = new THREE.Mesh(geo(new THREE.BoxGeometry(W, H, board)), boardMat);
    back.position.set(W / 2, 0, -T / 2 + board / 2);
    book.add(back);

    // the page block: page edges on three sides, the page you open to on top
    const blockT = T - 2 * board;
    const edgeX = texture(edgeCanvas(blockT / 1.6, false));  // fore-edge: lines vary across the thickness (u)
    const edgeY = texture(edgeCanvas(blockT / 1.6, true));   // head and tail: thickness runs along v
    // the page you open to: blank, the same grey-black for every app
    const pageMat = mat({ color: new THREE.Color(PAGE_BLACK) });
    const block = new THREE.Mesh(geo(new THREE.BoxGeometry(pageW, pageH, blockT)), [
      mat({ map: edgeX }), paperMat, mat({ map: edgeY }), mat({ map: edgeY }), pageMat, paperMat,
    ]);
    block.position.set(1 + pageW / 2, 0, 0);
    book.add(block);

    // the front cover, on its hinge at the spine's outer edge
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, T / 2);
    const cover = new THREE.Mesh(geo(new THREE.BoxGeometry(W, H, board)), [
      boardMat, boardMat, boardMat, boardMat, mat({ map: texture(coverCanvas(o.text, o.color, W, H)) }), endMat,
    ]);
    cover.position.set(W / 2, 0, -board / 2);
    hinge.add(cover);
    book.add(hinge);

    let covered = false;
    const apply = (t: number) => {
      const s = P.pose(t);
      book.rotation.set(s.tilt, s.yaw, s.roll);
      const [ox, oy, oz] = tiltPivot(H, s.tilt);
      const c = Math.cos(s.roll), sn = Math.sin(s.roll);
      book.position.set(s.pos[0] + ox * c - oy * sn, s.pos[1] + ox * sn + oy * c, s.pos[2] + oz);
      hinge.rotation.y = s.cover;
      // once the cover is past halfway open its edges face you: black like the pages, not a light seam
      const edge = s.cover < -Math.PI / 2 ? endMat : boardMat;
      const mats = cover.material as THREE.Material[];
      for (let i = 0; i < 4; i++) mats[i] = edge;
      setEye(s.eye);
      renderer.setClearColor(BACKDROP, s.backdrop);
      renderer.render(scene, camera);
    };

    // first frame drawn before the real spine hides, so nothing blinks
    apply(0);
    document.body.append(cv);
    await nextFrame();
    o.spine.style.visibility = "hidden";

    let ready = false;
    const cover_ = () => {
      if (covered) return;
      covered = true;
      o.onCovered();
      Promise.race([o.ready(), wait(1500)]).then(() => (ready = true));
    };

    await new Promise<void>((done) => {
      // testing: window.__bookSeek = true hands the clock to the test, which calls __bookSeek(t)
      const w = window as unknown as { __bookSeek?: boolean | ((t: number) => void) };
      if (w.__bookSeek === true) {
        w.__bookSeek = (t: number) => {
          if (t >= T_NAVIGATE) cover_();
          apply(Math.min(t, T_END));
          cv.style.opacity = String(1 - clamp((t - T_END) / FADE_MS));
          if (t >= T_END + FADE_MS) done();
        };
        return;
      }
      let clock = 0, last = performance.now();
      cv.addEventListener("click", () => { if (clock < T_TURNED) clock = T_TURNED; }); // impatient: skip ahead
      const frame = (now: number) => {
        const dt = now - last;
        last = now;
        if (clock >= T_NAVIGATE) cover_();
        // hold with the book open until the stats page has its data
        clock = clock >= T_OPEN && !ready ? T_OPEN : clock + dt;
        apply(Math.min(clock, T_END));
        cv.style.opacity = String(1 - clamp((clock - T_END) / FADE_MS));   // the real page fades in
        if (clock >= T_END + FADE_MS) return done();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return true;
  } finally {
    cleanup();
  }
}

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
