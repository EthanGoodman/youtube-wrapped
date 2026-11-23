/* The "pulled out" tape: the selected app's numbers and its two doors (Stats, Wrapped). */
import { PlatformSummary } from "../../api";
import { date, num } from "../../format";
import { HubLink } from "../../platform";
import { hoursOf } from "./Spine";

interface Props { p: PlatformSummary; totalHours: number; latestYear: number | null }

export function SpineDetail({ p, totalHours, latestYear }: Props) {
  const hours = hoursOf(p);
  const pct = totalHours ? Math.round((hours / totalHours) * 100) : 0;
  const estimated = p.capabilities.includes("estimated_time") ? " (estimated)" : "";
  const parts = [
    `${num(hours)} h${estimated}`,
    `${pct < 1 && hours ? "<1" : pct}% of your time`,
    `${num(p.items ?? 0)} ${p.vocab.items}`,
    p.first_date ? `since ${date(p.first_date)}` : "",
    p.last_date ? `last ${date(p.last_date)}` : "",
  ].filter(Boolean);
  return (
    <section aria-live="polite" aria-label={`${p.name} details`}
             className="mt-6 flex flex-wrap items-end justify-between gap-6 border-t-2 border-[#EDE7DC] py-5">
      <div className="min-w-0">
        <h2 className="m-0 font-shelf-display text-[64px] font-normal uppercase leading-none">{p.name}</h2>
        <p className="mt-2 font-shelf-mono text-[13px] text-[#C9C2B5]">{parts.join(" · ")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <HubLink to={`/${p.id}`}
                 className="shelf-focus flex h-11 items-center border-2 border-[#EDE7DC] px-5 font-shelf-sans text-[15px] font-bold text-[#EDE7DC] hover:bg-[#EDE7DC] hover:text-[#141312]">
          Stats
        </HubLink>
        <HubLink to={`/${p.id}/wrapped${latestYear ? `?year=${latestYear}` : ""}`}
                 className="shelf-focus flex h-11 items-center border-2 border-[#EDE7DC] bg-[#EDE7DC] px-5 font-shelf-sans text-[15px] font-bold text-[#141312] hover:bg-white">
          {latestYear ? `${latestYear} Wrapped` : "Wrapped"}
        </HubLink>
      </div>
    </section>
  );
}
