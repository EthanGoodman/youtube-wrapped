/* The home page: a shelf, and nothing else. Every app with data is a book spine as thick as its hours;
   clicking one pulls it off the shelf and opens it into the app's stats page (book3d/, WebGL, loaded on demand). Apps not added
   yet are empty slots that say how long their data takes to arrive.
   Design spec: "The shelf" (flat color, no gradients/shadows/rounding, our own spine colors, self-hosted fonts). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PlatformSummary, usePlatforms } from "../api";
import { compact, num } from "../format";
import { HubLink } from "../platform";
import { shelfColors } from "../themes";
import { EmptySlot } from "../components/shelf/EmptySlot";
import { Spine, hoursOf, monthYear } from "../components/shelf/Spine";
import { SHELF_MAX_H, hoursLabel, shelfHeight, slotHeight, waitRank } from "../components/shelf/scale";
import { cameraDistance, tiltFromHeight } from "../components/shelf/book3d/timeline";

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}

/** The tallest spine that keeps the whole shelf (plank included) inside the window, so a laptop sees
 *  heading, intro and shelf without scrolling. Re-measured when the window changes. */
function useShelfHeight(enabled: boolean, below: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(SHELF_MAX_H);
  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      setH(shelfHeight(window.innerHeight - top - below));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, below]);
  return [ref, h] as const;
}

const loadBook = () => import("../components/shelf/book3d/scene");
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Resolves once the new page has fetched what it needs (nothing in flight), so the cover opens onto it. */
function settled(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  return new Promise((res) => {
    const check = () => (qc.isFetching() === 0 ? res() : setTimeout(check, 50));
    setTimeout(check, 50);
  });
}

export function Hub() {
  const q = usePlatforms();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const phone = useMedia("(max-width: 639px)");
  const tablet = useMedia("(max-width: 1023px)");

  const list = q.data ?? [];
  const ready = list.filter((p) => p.has_data).sort((a, b) => (b.est_s ?? 0) - (a.est_s ?? 0));
  const notYet = [
    ...list.filter((p) => p.implemented && !p.has_data).sort((a, b) => waitRank(a.export_wait) - waitRank(b.export_wait)),
    ...list.filter((p) => !p.implemented && p.issue),
  ];
  const firstVisit = !!q.data && ready.length === 0;
  // room under the shelf: lift room + plank + page padding (+ the "Add your first app" button)
  const [shelfRef, maxH] = useShelfHeight(!phone && !q.isLoading, firstVisit ? 144 : 72);
  const slots = notYet.slice(0, firstVisit ? 5 : tablet && !phone ? 2 : 3);
  const more = notYet.length - slots.length;
  const colors = shelfColors(ready.map((p) => p.id));
  const max = Math.max(1, ...ready.map(hoursOf));
  const total = ready.reduce((s, p) => s + hoursOf(p), 0);

  // fetch the 3D code while the shelf sits idle, so the first click starts at once
  useEffect(() => {
    if (!ready.length || prefersReducedMotion()) return;
    const id = setTimeout(() => void loadBook().catch(() => {}), 1200);
    return () => clearTimeout(id);
  }, [ready.length]);

  const open = async (p: PlatformSummary, spine: HTMLElement) => {
    const to = `/${p.id}`;
    if (prefersReducedMotion()) return navigate(to);
    const items = `${compact(p.items ?? 0)} ${p.vocab.items}`;
    const since = p.first_date ? `since ${monthYear(p.first_date)}` : "";
    try {
      const { openBook3d } = await loadBook();
      // how far the hover has tipped it (none on touch; maybe partway if the click came quickly)
      const view = { w: window.innerWidth, h: window.innerHeight };
      const tilt0 = phone ? 0 : tiltFromHeight(spine.getBoundingClientRect().height, spine.offsetHeight, cameraDistance(view));
      const played = await openBook3d({
        spine, axis: phone ? "x" : "y", color: colors[p.id], tilt0,
        text: {
          name: p.name, hours: `${num(hoursOf(p))} hours`, line: [items, since].filter(Boolean).join(" · "),
          spineHours: hoursLabel(num(hoursOf(p))), spineMeta: [items, since].filter(Boolean),
        },
        onCovered: () => navigate(to),
        ready: () => settled(qc),
      });
      if (!played) navigate(to);   // no WebGL: just go
    } catch {
      navigate(to);
    }
  };

  const slotSize = { w: tablet ? 72 : 84, h: slotHeight(tablet ? Math.min(maxH, 400) : maxH, firstVisit) };
  const pad = phone ? "px-4" : tablet ? "px-6" : "px-12";

  return (
    <div className="min-h-screen bg-[#141312] font-shelf-sans text-[#EDE7DC]"
         style={{ "--book-d": `${cameraDistance({ w: window.innerWidth, h: window.innerHeight })}px` } as React.CSSProperties}>
      <div className={`shelf-page mx-auto max-w-[1344px] pb-8 pt-8 ${pad}`}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <HubLink to="/" className="shelf-focus font-shelf-display text-[30px] uppercase leading-none tracking-[0.06em] text-[#EDE7DC] no-underline">
            Wrapped
          </HubLink>
          <nav aria-label="Main" className="flex gap-6 text-[15px] font-medium">
            <HubLink to="/sources" className="shelf-focus text-[#EDE7DC] underline underline-offset-4">Add an app</HubLink>
          </nav>
        </header>

        <section className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6" style={{ marginTop: phone ? 40 : "clamp(24px, 6vh, 64px)" }}>
          {/* sized by width AND height, so a short laptop window still shows the whole shelf */}
          <h1 className="m-0 font-shelf-display font-normal uppercase leading-[0.85]" style={{ fontSize: "clamp(64px, min(9.6vw, 15vh), 140px)" }}>
            {firstVisit ? "Start your collection" : "Your collection"}
          </h1>
          <p className={`m-0 max-w-[420px] text-[18px] leading-normal text-[#C9C2B5] ${tablet ? "basis-full" : ""}`}>
            {firstVisit
              ? "Every app you add becomes a book on the shelf. Your history stays on this computer."
              : <>Every app you add becomes a book on the shelf. {num(total)} hours so far. Pull one off and open it.</>}
          </p>
        </section>

        <section aria-label="Your apps" ref={shelfRef} style={{ marginTop: phone ? 40 : "clamp(20px, 5vh, 56px)" }}>
          {q.error ? (
            <div className="py-10">
              <p className="m-0 text-[18px]">Couldn't reach the app's server: {q.error.message}</p>
              <button type="button" onClick={() => q.refetch()}
                      className="shelf-focus mt-4 h-11 border-2 border-[#EDE7DC] px-5 text-[15px] font-bold">Try again</button>
            </div>
          ) : (
            <>
              <Shelf phone={phone} busy={q.isLoading} minH={maxH}>
                {q.isLoading ? <LoadingSpines phone={phone} /> : (
                  <>
                    {ready.map((p) => (
                      <Spine key={p.id} p={p} max={max} color={colors[p.id]} flat={phone} maxW={tablet ? 180 : 220} maxH={maxH}
                             onOpen={(el) => void open(p, el)} />
                    ))}
                    {slots.map((p, i) => (
                      <div key={p.id} className={!phone && i === 0 && ready.length ? "ml-6" : phone ? "w-full" : ""}>
                        <EmptySlot p={p} w={slotSize.w} h={slotSize.h} flat={phone} />
                      </div>
                    ))}
                    {more > 0 && <div className={phone ? "w-full" : ""}><EmptySlot more={more} w={slotSize.w} h={slotSize.h} flat={phone} /></div>}
                  </>
                )}
              </Shelf>
              {firstVisit && (
                <HubLink to="/sources"
                         className="shelf-focus mt-6 inline-flex h-12 items-center bg-[#EDE7DC] px-6 text-[16px] font-bold text-[#141312] hover:bg-white">
                  Add your first app
                </HubLink>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** The row of spines standing on a plank (phone: a stack lying on it). */
function Shelf({ phone, busy, minH, children }: { phone: boolean; busy: boolean; minH: number; children: React.ReactNode }) {
  return (
    <div aria-busy={busy}>
      <div className={phone ? "flex flex-col gap-2 pt-2" : "flex flex-wrap items-end gap-[10px] pt-3"}
           style={phone ? undefined : { minHeight: minH }}>{children}</div>
      {/* a wooden plank: a lit top edge, the grained front, and its shadow on the wall */}
      <div aria-hidden className="shelf-plank" />
      <div aria-hidden className="h-[6px] bg-[#0B0A09]" />
    </div>
  );
}

function LoadingSpines({ phone }: { phone: boolean }) {
  const sizes: [number, number][] = [[220, 460], [140, 430], [64, 400]];
  return (
    <>
      {sizes.map(([w, h]) => (
        <span key={w} aria-hidden className="block bg-[#2A2622]" style={phone ? { width: "100%", height: Math.round(w / 2.2) + 30 } : { width: w, height: h }} />
      ))}
    </>
  );
}
