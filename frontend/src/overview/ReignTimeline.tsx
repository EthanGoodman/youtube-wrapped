/* "Your #1 channel each year" as a timeline of reigns: a run of years with the same #1 is one block, as wide as the
   run, and the longest run is highlighted. Shared by the home page and the Evolution page. */
import { Link } from "../platform";
import { useMeta } from "../api";
import { Avatar, OV, Poster, ScrollRow, useCreator, useFamily, useTime, useVerb } from "./kit";
import { groupReigns, longestReign, monthDay } from "./takeaways";

export interface YearTop { year: number; channel_id: string; title?: string | null; avatar_url?: string | null; time_s: number; count: number }

/** The headline for a set of years: the longest run, or "a different #1" when nobody held it twice. */
export function reignTitle(rows: YearTop[]): string {
  const r = longestReign(rows);
  return r && r.years >= 2 ? `${r.title} was your #1 ${r.years} years running.` : "A different #1 almost every year.";
}

export function ReignTimeline({ rows, calendarYears = false }: { rows: YearTop[]; calendarYears?: boolean }) {
  const tm = useTime();
  const cr = useCreator();
  const { verbed } = useVerb();
  const meta = useMeta().data;
  const reign = longestReign(rows);
  const thisYear = Number(meta?.today.slice(0, 4));
  // your history may start mid-year: say so, or that year's small number looks odd
  const firstYear = Number(meta?.first_date?.slice(0, 4));
  const firstMd = meta?.first_date?.slice(5) ?? "01-01";
  const games = useFamily() === "games";
  const note = (
    <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
      {tm.Unit} are what you {verbed} of that {cr.one}{calendarYears ? " in those calendar years" : ""}. Pick a year to open its Wrapped.
    </p>
  );
  // games: the box art is the point, so each year is a big cover with the title and hours under it, like the top 10 row
  if (games) return (
    <>
      <ScrollRow outer="-mx-4 sm:mx-0" className="snap-x px-4 sm:px-0 lg:overflow-visible">
        <ol className="flex gap-4 pb-2 pt-2 lg:grid" style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 10)},minmax(0,1fr))` }}>
          {rows.map((y, i) => {
            // part of the longest run of years with the same #1 (a neighbor year has the same game)
            const star = reign != null && reign.years >= 2 && reign.title === y.title && (rows[i - 1]?.title === y.title || rows[i + 1]?.title === y.title);
            const partial = y.year === firstYear && firstMd !== "01-01";
            return (
              <li key={y.year} className="w-[130px] shrink-0 snap-start lg:w-auto lg:min-w-0">
                <Link to={`/wrapped?year=${y.year}`} className="group flex flex-col items-start gap-2"
                      aria-label={`${y.year}: your #1 was ${y.title ?? "unknown"}, ${tm.fmt(y.time_s)}. Open ${y.year} Wrapped`}>
                  <span className="relative w-full">
                    <Poster src={y.avatar_url} name={y.title} width="100%" className="transition-transform duration-150 group-hover:-translate-y-0.5" />
                    <span className="absolute -left-2 -top-2 rounded-full border-[3px] px-2.5 py-1 font-ov-display text-[14px] font-extrabold leading-none"
                          style={{ background: star ? OV.mustard : OV.paper, borderColor: OV.ink }}>{y.year}{y.year === thisYear ? " so far" : ""}</span>
                  </span>
                  <span className="w-full truncate text-[15px] font-bold group-hover:underline">{y.title}</span>
                  <span className="font-ov-display text-[17px] font-extrabold leading-tight">{tm.fmt(y.time_s)}</span>
                  {partial && <span className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>from {monthDay(meta?.first_date)}</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </ScrollRow>
      {note}
    </>
  );
  return (
    <>
      <ScrollRow outer="-mx-4 sm:mx-0" className="px-4 sm:px-0">
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
                <Avatar src={g.first.avatar_url} name={g.first.title} size={star ? 68 : 48} />
                <span className="w-full truncate text-[14px] font-bold">{g.first.title}</span>
                <span className="font-ov-display text-[20px] font-extrabold leading-none">{tm.fmt(g.total_s)}</span>
                {g.years.length > 1 && (
                  <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {g.years.map((y) => (
                      <Link key={y.year} to={`/wrapped?year=${y.year}`}
                            className="rounded-full border px-2 py-0.5 font-shelf-mono text-[11px] hover:underline"
                            style={{ borderColor: OV.ink, background: star ? OV.paper : "transparent" }}
                            aria-label={`${y.year}: ${tm.fmt(y.time_s)} of ${g.first.title ?? `this ${cr.one}`}. Open ${y.year} Wrapped`}>
                        {y.year} · {tm.fmt(y.time_s)}
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
                      aria-label={`${g.from}: your #1 was ${g.first.title ?? "unknown"}, ${tm.fmt(g.total_s)}. Open ${g.from} Wrapped`}>
                  {body}
                </Link>
              </li>
            ) : (
              <li key={g.from} className={`min-w-0 ${cls}`} style={style}>{body}</li>
            );
          })}
        </ol>
      </ScrollRow>
      <p className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>
        {tm.Unit} are what you {verbed} of that {cr.one}{calendarYears ? " in those calendar years" : ""}. Pick a year to open its Wrapped.
      </p>
    </>
  );
}
