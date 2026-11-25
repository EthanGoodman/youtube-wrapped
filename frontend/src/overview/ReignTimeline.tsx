/* "Your #1 channel each year" as a timeline of reigns: a run of years with the same #1 is one block, as wide as the
   run, and the longest run is highlighted. Shared by the home page and the Evolution page. */
import { Link } from "../platform";
import { useMeta } from "../api";
import { OV, Pic } from "./kit";
import { groupReigns, hoursShort, longestReign, monthDay } from "./takeaways";

export interface YearTop { year: number; channel_id: string; title?: string | null; avatar_url?: string | null; time_s: number; count: number }

/** The headline for a set of years: the longest run, or "a different #1" when nobody held it twice. */
export function reignTitle(rows: YearTop[]): string {
  const r = longestReign(rows);
  return r && r.years >= 2 ? `${r.title} was your #1 ${r.years} years running.` : "A different #1 almost every year.";
}

export function ReignTimeline({ rows, calendarYears = false }: { rows: YearTop[]; calendarYears?: boolean }) {
  const meta = useMeta().data;
  const reign = longestReign(rows);
  const thisYear = Number(meta?.today.slice(0, 4));
  // your history may start mid-year: say so, or that year's small number looks odd
  const firstYear = Number(meta?.first_date?.slice(0, 4));
  const firstMd = meta?.first_date?.slice(5) ?? "01-01";
  return (
    <>
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ol className="grid min-w-[560px] gap-3" style={{ gridTemplateColumns: `repeat(${rows.length},minmax(0,1fr))` }}>
          {groupReigns(rows).map((g) => {
            const star = reign != null && reign.years >= 2 && g.years.length === reign.years && g.first.title === reign.title;
            const live = g.to === thisYear;
            const partial = g.from === firstYear && firstMd !== "01-01";
            const span = g.from === g.to ? `${g.from}${live ? " so far" : ""}` : `${g.from}–${live ? "now" : g.to}`;
            const body = (
              <>
                <span className="flex flex-col font-shelf-mono text-[12px] font-medium">{span}
                  {partial && <span className="text-[11px] font-normal" style={{ color: OV.soft }}>from {monthDay(meta?.first_date)}</span>}</span>
                <Pic src={g.first.avatar_url} name={g.first.title} size={star ? "68px" : "48px"} />
                <span className="w-full truncate text-[14px] font-bold">{g.first.title}</span>
                <span className="font-ov-display text-[20px] font-extrabold leading-none">{hoursShort(g.total_s)}</span>
                {g.years.length > 1 && (
                  <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {g.years.map((y) => (
                      <Link key={y.year} to={`/wrapped?year=${y.year}`}
                            className="rounded-full border px-2 py-0.5 font-shelf-mono text-[11px] hover:underline"
                            style={{ borderColor: OV.ink, background: star ? OV.paper : "transparent" }}
                            aria-label={`${y.year}: ${hoursShort(y.time_s)} of ${g.first.title ?? "this channel"}. Open ${y.year} Wrapped`}>
                        {y.year} · {hoursShort(y.time_s)}
                      </Link>
                    ))}
                  </span>
                )}
              </>
            );
            const cls = "flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center";
            const style = { gridColumn: `span ${g.years.length}`, background: star ? OV.mustard : OV.paper, borderColor: star ? OV.ink : "#D9CDB6" };
            return g.years.length === 1 ? (
              <li key={g.from} className="min-w-0" style={{ gridColumn: style.gridColumn }}>
                <Link to={`/wrapped?year=${g.from}`} className={`${cls} group hover:brightness-[0.98]`} style={style}
                      aria-label={`${g.from}: your #1 was ${g.first.title ?? "unknown"}, ${hoursShort(g.total_s)}. Open ${g.from} Wrapped`}>
                  {body}
                </Link>
              </li>
            ) : (
              <li key={g.from} className={`min-w-0 ${cls}`} style={style}>{body}</li>
            );
          })}
        </ol>
      </div>
      <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
        Hours are what you watched of that channel{calendarYears ? " in those calendar years" : ""}. Pick a year to open its Wrapped.
      </p>
    </>
  );
}
