/* The home page: a shelf. Every app with data is a tape spine as thick as its hours; apps not added yet
   are empty slots that say how long their data takes to arrive; below, a shelf of year boxes.
   Design spec: "The shelf" (flat color, no gradients/shadows/rounding, our own spine colors, self-hosted fonts). */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getJson, usePlatforms } from "../api";
import { num } from "../format";
import { HubLink } from "../platform";
import { shelfColors } from "../themes";
import { EmptySlot } from "../components/shelf/EmptySlot";
import { Spine, hoursOf } from "../components/shelf/Spine";
import { SpineDetail } from "../components/shelf/SpineDetail";
import { HubYear, YearBoxes } from "../components/shelf/YearBoxes";
import { waitRank } from "../components/shelf/scale";

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

/** "YouTube, Netflix or Crunchyroll" */
function orList(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function Hub() {
  const q = usePlatforms();
  const yearsQ = useQuery<HubYear[], ApiError>({ queryKey: ["hub-years"], queryFn: () => getJson("/api/hub/years") });
  const phone = useMedia("(max-width: 639px)");
  const tablet = useMedia("(max-width: 1023px)");
  const [picked, setPicked] = useState<string | null>(null);

  const list = q.data ?? [];
  const ready = list.filter((p) => p.has_data).sort((a, b) => (b.est_s ?? 0) - (a.est_s ?? 0));
  const notYet = [
    ...list.filter((p) => p.implemented && !p.has_data).sort((a, b) => waitRank(a.export_wait) - waitRank(b.export_wait)),
    ...list.filter((p) => !p.implemented && p.issue),
  ];
  const firstVisit = !!q.data && ready.length === 0;
  const slots = notYet.slice(0, firstVisit ? 5 : tablet && !phone ? 2 : 3);
  const more = notYet.length - slots.length;
  const colors = shelfColors(ready.map((p) => p.id));
  const max = Math.max(1, ...ready.map(hoursOf));
  const total = ready.reduce((s, p) => s + hoursOf(p), 0);
  const selected = ready.find((p) => p.id === picked) ?? ready[0];
  const years = yearsQ.data ?? [];
  const latestYear = (id: string) => [...years].reverse().find((y) => y.by_platform[id])?.year ?? null;
  const names = Object.fromEntries(list.map((p) => [p.id, p.name]));

  const slotSize = tablet ? { w: 72, h: firstVisit ? 400 : 340 } : { w: 84, h: firstVisit ? 460 : 380 };
  const pad = phone ? "px-4" : tablet ? "px-6" : "px-12";

  return (
    <div className="min-h-screen bg-[#141312] font-shelf-sans text-[#EDE7DC]">
      <div className={`shelf-page mx-auto max-w-[1344px] pb-14 pt-8 ${pad}`}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <HubLink to="/" className="shelf-focus font-shelf-display text-[30px] uppercase leading-none tracking-[0.06em] text-[#EDE7DC] no-underline">
            Wrapped
          </HubLink>
          <nav aria-label="Main" className="flex gap-6 text-[15px] font-medium">
            {years.length > 0 && <a href="#years" className="shelf-focus text-[#EDE7DC] underline underline-offset-4">Your years</a>}
            <HubLink to="/sources" className="shelf-focus text-[#EDE7DC] underline underline-offset-4">Add an app</HubLink>
          </nav>
        </header>

        <section className={`flex flex-wrap items-end justify-between gap-x-12 gap-y-6 ${phone ? "mt-10" : "mt-16"}`}>
          <h1 className="m-0 font-shelf-display font-normal uppercase leading-[0.85]" style={{ fontSize: "clamp(72px, 10vw, 150px)" }}>
            {firstVisit ? "Start your collection" : "Your collection"}
          </h1>
          <p className={`m-0 max-w-[420px] text-[18px] leading-normal text-[#C9C2B5] ${tablet ? "basis-full" : ""}`}>
            {firstVisit
              ? "Every app you add becomes a tape on the shelf, as thick as the time you gave it. Your history stays on this computer."
              : <>Every app you add becomes a tape on the shelf, as thick as the time you gave it. {num(total)} hours so far. Pull one out to see its stats and its Wrapped.</>}
          </p>
        </section>

        <section aria-label="Your apps" className={phone ? "mt-10" : "mt-14"}>
          {q.error ? (
            <div className="py-10">
              <p className="m-0 text-[18px]">Couldn't reach the app's server: {q.error.message}</p>
              <button type="button" onClick={() => q.refetch()}
                      className="shelf-focus mt-4 h-11 border-2 border-[#EDE7DC] px-5 text-[15px] font-bold">Try again</button>
            </div>
          ) : (
            <>
              <Shelf phone={phone} busy={q.isLoading}>
                {q.isLoading ? <LoadingSpines phone={phone} /> : (
                  <>
                    {ready.map((p) => (
                      <Spine key={p.id} p={p} max={max} color={colors[p.id]} flat={phone} maxW={tablet ? 180 : 220}
                             selected={selected?.id === p.id} onSelect={() => setPicked(p.id)} />
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
              <p className="mb-0 mt-4 font-shelf-mono text-[13px] text-[#A39B8D]">
                Thickness = hours. Empty slots are apps you haven't added yet; each one says how long its data takes to arrive.
              </p>
              {firstVisit && (
                <HubLink to="/sources"
                         className="shelf-focus mt-6 inline-flex h-12 items-center bg-[#EDE7DC] px-6 text-[16px] font-bold text-[#141312] hover:bg-white">
                  Add your first app
                </HubLink>
              )}
              {selected && <SpineDetail p={selected} totalHours={total} latestYear={latestYear(selected.id)} />}
            </>
          )}
        </section>

        {!firstVisit && <YearBoxes years={years} names={names} currentYear={new Date().getFullYear()} scroll={phone} />}

        <footer className="mt-12 text-[13px] text-[#8F887C]">
          Made on this computer from files you exported.
          {ready.length > 0 && <> Not affiliated with {orList(ready.map((p) => p.name))}.</>}
        </footer>
      </div>
    </div>
  );
}

/** The row of spines standing on a plank (phone: a stack lying on it). */
function Shelf({ phone, busy, children }: { phone: boolean; busy: boolean; children: React.ReactNode }) {
  return (
    <div aria-busy={busy}>
      <div className={phone ? "flex flex-col gap-2 pt-2" : "flex min-h-[460px] flex-wrap items-end gap-[10px] pt-3"}>{children}</div>
      <div aria-hidden className="h-[14px] bg-[#3A332A]" />
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
