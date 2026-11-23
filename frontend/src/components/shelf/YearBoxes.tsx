/* The second shelf: one box per year, as tall as that year's hours, each opening that year's Wrapped. */
import { useEffect, useRef, useState } from "react";
import { num } from "../../format";
import { HubLink } from "../../platform";
import { useDismiss } from "../../families/shows/Shell";
import { yearBoxHeight } from "./scale";

export interface HubYear { year: number; est_s: number; by_platform: Record<string, number> }

const hrs = (s: number) => Math.round(s / 3600);

/** Which years show by default: the latest 5, plus the biggest if it's older. */
export function defaultYears(years: HubYear[]): HubYear[] {
  if (years.length <= 5) return years;
  const latest = years.slice(-5);
  const biggest = years.reduce((a, b) => (b.est_s > a.est_s ? b : a));
  return latest.includes(biggest) ? latest : [biggest, ...latest];
}

interface Props { years: HubYear[]; names: Record<string, string>; currentYear: number; scroll?: boolean }

export function YearBoxes({ years, names, currentYear, scroll = false }: Props) {
  const [all, setAll] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll && row.current) row.current.scrollLeft = row.current.scrollWidth;
  }, [scroll, years.length, all]);
  if (!years.length) return null;
  const shown = all ? years : defaultYears(years);
  const max = Math.max(...years.map((y) => y.est_s));
  const biggest = years.find((y) => y.est_s === max)!.year;
  return (
    <section id="years" aria-labelledby="years-h" className="mt-[72px] scroll-mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="years-h" className="m-0 font-shelf-display text-[56px] font-normal uppercase leading-none">Year boxes</h2>
        {years.length > shown.length || all ? (
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all}
                  className="shelf-focus font-shelf-sans text-[15px] font-medium text-[#EDE7DC] underline underline-offset-4">
            {all ? "Fewer years" : `All ${years.length} years →`}
          </button>
        ) : null}
      </div>
      <div ref={row} className={`mt-5 flex min-h-[260px] items-end gap-3 ${scroll ? "no-scrollbar overflow-x-auto pt-3" : "flex-wrap"}`}>
        {shown.map((y) => (
          <YearBox key={y.year} y={y} max={max} names={names} biggest={y.year === biggest} current={y.year === currentYear} />
        ))}
      </div>
      <div aria-hidden className="h-[14px] bg-[#3A332A]" />
    </section>
  );
}

function YearBox({ y, max, names, biggest, current }: { y: HubYear; max: number; names: Record<string, string>; biggest: boolean; current: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const apps = Object.entries(y.by_platform).sort((a, b) => b[1] - a[1]);
  const h = hrs(y.est_s);
  const style = { height: yearBoxHeight(y.est_s, max) };
  const cls = `shelf-lift shelf-focus flex w-[120px] shrink-0 flex-col justify-between p-4 text-left ${
    current ? "bg-[#EDE7DC] text-[#141312]" : "bg-[#2A2622] text-[#EDE7DC]"} ${biggest ? "border-t-[6px] border-[#E58A2E]" : ""}`;
  const body = (
    <>
      <span className="font-shelf-display text-[44px] leading-none">{y.year}</span>
      <span className="font-shelf-mono text-[13px] leading-snug">
        {num(h)} h
        {(current || biggest) && <span className="block text-[11px]">{current ? "so far" : "your biggest"}</span>}
      </span>
    </>
  );
  const label = `${y.year}: ${num(h)} hours${current ? " so far" : ""}${biggest ? ", your biggest year" : ""}`;
  if (apps.length === 1) {
    return <HubLink to={`/${apps[0][0]}/wrapped?year=${y.year}`} aria-label={`${label}. Play ${names[apps[0][0]] ?? apps[0][0]} Wrapped`} className={cls} style={style}>{body}</HubLink>;
  }
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${label}. Choose an app`}
              className={cls} style={style}>{body}</button>
      {open && (
        <ul className="absolute left-0 top-full z-20 mt-2 w-72 list-none border-2 border-[#EDE7DC] bg-[#141312] p-1">
          {apps.map(([id, s]) => (
            <li key={id}>
              <HubLink to={`/${id}/wrapped?year=${y.year}`}
                       className="shelf-focus flex justify-between gap-3 px-3 py-2.5 font-shelf-sans text-[14px] text-[#EDE7DC] hover:bg-[#2A2622]">
                <span>{names[id] ?? id} Wrapped</span><span className="whitespace-nowrap font-shelf-mono text-[13px] text-[#A39B8D]">{num(hrs(s))} h</span>
              </HubLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
