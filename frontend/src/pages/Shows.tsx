import { useState } from "react";
import { TopResponse, useStats } from "../api";
import { RankedRows } from "../components/lists";
import { PageTitle, QueryState, Section, StatTile } from "../components/ui";
import { Binge, BingeRows, ShowProgress, ShowProgressRows, ShowStatus, STATUS_LABEL, useShows } from "../components/shows";
import { num } from "../format";
import { rangeLabel, useFilters } from "../filters";

type Progress = { summary: Record<ShowStatus, number>; shows: ShowProgress[] };
type Rewatches = { detectable: boolean; items: TopResponse["items"] };

const FILTERS: (ShowStatus | "all")[] = ["all", "finished", "watching", "dropped"];

/** Netflix-only page: how far you got into each show, season binges and rewatches. */
export function Shows() {
  const { filters } = useFilters();
  const period = rangeLabel(filters);
  const progress = useShows<Progress>("progress", { limit: 200 });
  const binges = useShows<Binge[]>("binges", { limit: 10 });
  const rewatches = useShows<Rewatches>("rewatches");
  const [status, setStatus] = useState<ShowStatus | "all">("all");

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Shows" subtitle={`Shows you watched from ${period}, and how far you got`} />

      <QueryState q={progress} minHeight={110}>
        {({ data: { summary, shows } }) => (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <StatTile label="Shows" value={num(shows.length)} />
            <StatTile label="Finished" value={num(summary.finished)} hint="watched up to the latest episode" />
            <StatTile label="Still watching" value={num(summary.watching)} hint="watched in the last 30 days" />
            <StatTile label="Dropped" value={num(summary.dropped)} hint="not finished, not watched in 30+ days" />
          </div>
        )}
      </QueryState>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Show progress" subtitle="Episodes count everything you watched up to the end of the period"
                 className="lg:col-span-3"
                 action={
                   <div className="seg" role="group" aria-label="Show status">
                     {FILTERS.map((s) => (
                       <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                         {s === "all" ? "All" : STATUS_LABEL[s]}
                       </button>
                     ))}
                   </div>
                 }>
          <QueryState q={progress} minHeight={300}
                      empty={(d) => !d.data.shows.some((s) => status === "all" || s.status === status)}>
            {(d) => <ShowProgressRows shows={d.data.shows.filter((s) => status === "all" || s.status === status)} />}
          </QueryState>
        </Section>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Fastest seasons" subtitle="Whole seasons, from first episode to last">
            <QueryState q={binges} minHeight={200} empty={(d) => !d.data.length}>
              {(d) => <BingeRows binges={d.data} />}
            </QueryState>
          </Section>
          <Section title="Rewatches" subtitle="Watched again at least a week later">
            <QueryState q={rewatches} minHeight={120}>
              {({ data }) => !data.detectable ? (
                <p className="text-sm text-muted">
                  Netflix's quick download lists each title only once, so rewatches can't be seen. Add the full data
                  export (ViewingActivity.csv) to find them.
                </p>
              ) : data.items.length ? (
                <RankedRows items={data.items} kind="video" compactRows />
              ) : (
                <p className="text-sm text-muted">Nothing rewatched in this period.</p>
              )}
            </QueryState>
          </Section>
        </div>
      </div>

      <TopMovies />
    </div>
  );
}

function TopMovies() {
  const movies = useStats<TopResponse>("top/movies", { limit: 10 });
  return (
    <Section title="Movies" subtitle="The movies you watched in this period">
      <QueryState q={movies} minHeight={120} empty={(d) => !d.items.length}>
        {(d) => <RankedRows items={d.items} kind="video" compactRows />}
      </QueryState>
    </Section>
  );
}
