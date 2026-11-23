/* Evolution on Netflix: your #1 show of every year, the bar chart race, loyalty and drop-offs. */
import { useMeta, useStats } from "../../api";
import { Link } from "../../platform";
import { QueryState, Section } from "../../components/ui";
import { PageHead, Poster, RED, Toggle, hours, plural } from "./ui";
import { date, num } from "../../format";
import { rangeLabel, useFilters, useLinkQuery } from "../../filters";
import { BarRace, Discovery, FellOff, Loyal, MixByYear, TopYear } from "../../pages/Evolution";

export function ShowsEvolution() {
  const { filters, update } = useFilters();
  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Evolution" subtitle="How your taste changed over the years">
        <Toggle label="Rank by" value={filters.metric} onChange={(m) => update({ metric: m })} options={[["count", "Episodes"], ["time", "Time"]]} />
      </PageHead>
      <YearRow />
      <BarRace />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <LoyalList />
        <FellOffList />
      </div>
      <Discoveries />
      <MixByYear />
    </div>
  );
}

function YearRow() {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const years = useStats<TopYear[]>("evolution/top_per_year");
  return (
    <Section title="Your #1 show of every year" subtitle="Tap a year for its full story">
      <QueryState q={years} minHeight={260} empty={(d) => !d.length}>
        {(d) => (
          <div className="no-scrollbar -mx-[4%] flex gap-4 overflow-x-auto px-[4%] pb-1">
            {d.map((y) => (
              <Link key={y.year} to={`/year/${y.year}${q}`} className="group w-[130px] shrink-0 sm:w-[150px]">
                <div className="mb-2 text-[30px] font-black leading-none tracking-tight" style={{ color: RED }}>{y.year}</div>
                <div className="transition-transform duration-200 group-hover:scale-[1.04]"><Poster src={y.avatar_url} /></div>
                <div className="mt-2 truncate text-[14px] font-bold">{y.title}</div>
                <div className="text-[12px] text-[#b3b3b3]">{filters.metric === "time" ? hours(y.time_s) : plural(y.count, "episode")}</div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function LoyalList() {
  const meta = useMeta().data;
  const q = useLinkQuery();
  const loyal = useStats<Loyal[]>("evolution/loyalty", { limit: 10 });
  const allYears = meta?.years ?? [];
  return (
    <Section title="Most loyal" subtitle="Shows you came back to in the most different years (3+ episodes a year)">
      <QueryState q={loyal} minHeight={300} empty={(d) => !d.length}>
        {(d) => (
          <ol className="flex flex-col">
            {d.map((c, i) => (
              <li key={c.channel_id}>
                <Link to={`/channel/${c.channel_id}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                  <span className="w-6 shrink-0 text-right text-[20px] font-black tabular text-[#595959]">{i + 1}</span>
                  <div className="w-10 shrink-0"><Poster src={c.avatar_url} size="w185" className="rounded-[3px]" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{c.title}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1" aria-label={`watched in ${c.year_list.join(", ")}`}>
                      {allYears.map((y) => (
                        <span key={y} title={String(y)} className="h-1.5 w-3"
                              style={{ background: c.year_list.includes(y) ? RED : "#404040" }} />
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold">{plural(c.years, "year")}</div>
                    <div className="text-[12px] text-[#808080]">{plural(c.count, "episode")}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

function FellOffList() {
  const q = useLinkQuery();
  const fell = useStats<FellOff[]>("evolution/fell_off", { limit: 10 });
  return (
    <Section title="Fell off" subtitle="Shows you watched a lot, then barely touched in the last year">
      <QueryState q={fell} minHeight={300} empty={(d) => !d.length}>
        {(d) => (
          <ol className="flex flex-col">
            {d.map((c) => (
              <li key={c.channel_id}>
                <Link to={`/channel/${c.channel_id}${q}`} className="-mx-3 flex items-center gap-4 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                  <div className="w-10 shrink-0"><Poster src={c.avatar_url} size="w185" className="rounded-[3px]" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{c.title}</div>
                    <div className="truncate text-[13px] text-[#b3b3b3]">peak {c.peak_year} · last watched {date(c.last_watched)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold">{plural(c.count_before, "ep")}</div>
                    <div className="text-[12px] text-[#808080]">{c.count_recent ? `${num(c.count_recent)} lately` : "none lately"}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

function Discoveries() {
  const { filters } = useFilters();
  const q = useLinkQuery();
  const disc = useStats<Discovery[]>("evolution/discoveries", { limit: 20 });
  return (
    <Section title={filters.range === "all" ? "When you found them" : "New discoveries"}
             subtitle={filters.range === "all" ? "Your biggest shows and when you started them (pick a period to see what was new then)"
                                               : `Shows you started for the first time, from ${rangeLabel(filters)}`}>
      <QueryState q={disc} minHeight={240} empty={(d) => !d.length}>
        {(d) => (
          <div className="no-scrollbar -mx-[4%] flex gap-3 overflow-x-auto px-[4%] pb-1">
            {d.map((c) => (
              <Link key={c.channel_id} to={`/channel/${c.channel_id}${q}`} className="group w-[118px] shrink-0">
                <div className="transition-transform duration-200 group-hover:scale-[1.04]"><Poster src={c.avatar_url} /></div>
                <div className="mt-2 truncate text-[13px] font-bold">{c.title}</div>
                <div className="text-[12px] text-[#b3b3b3]">since {date(c.first_watched)}</div>
                <div className="text-[12px] text-[#808080]">{plural(c.count, "ep")}</div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}
